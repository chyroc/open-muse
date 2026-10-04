import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLarkStateNote,
  larkStateNote,
  larkStateRoot,
  larkStateSync,
} from "../shared/lark-state";
import { toolingInstructions, toolingSetup } from "../shared/tooling";

// Runs the sandbox helper against an in-process stand-in for the service's
// compare-and-swap state, with its paths moved into a temporary directory.
function scenario(steps: string, stderr = "") {
  const dir = mkdtempSync(join(tmpdir(), "lark-state-"));
  try {
    const source = larkStateSync
      .replaceAll(larkStateRoot, `${dir}/root`)
      .replace("/opt/open-muse/lark-link.json", `${dir}/link.json`)
      .replace("/opt/open-muse/lark-state.saved", `${dir}/saved.json`)
      .replace(
        "/opt/open-muse/lark-credentials.json",
        `${dir}/credentials.json`,
      )
      .replace('if __name__ == "__main__":\n    main()', "");
    const harness = String.raw`
import json, os, shutil, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
store = {"revision": 0, "state": None, "puts": 0, "fail": False, "connection": None, "reads": 0}
class Service(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if store["fail"]: return self.reply(503, {})
        assert self.headers["Authorization"] == "Bearer token-1"
        if self.path.endswith("/credentials"):
            store["reads"] += 1
            if not store["connection"]: return self.reply(404, {})
            return self.reply(200, store["connection"])
        self.reply(200, {"revision": store["revision"], "state": store["state"]})
    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if body["base_revision"] != store["revision"]:
            return self.reply(409, {"code": "lark_state_changed"})
        store.update(revision=store["revision"] + 1, state=body["state"], puts=store["puts"] + 1)
        self.reply(200, {"revision": store["revision"]})
server = HTTPServer(("127.0.0.1", 0), Service)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = "https://example.invalid/v1/lark/sandbox/state"
DIR = ${JSON.stringify(dir)}
exec(compile(sys.stdin.read(), "lark_state.py", "exec"))
real_call = call
def call(method, body=None, path="state"):
    # The helper requires https; the stand-in listens on plain http.
    with open(LINK) as handle: link = json.load(handle)
    link["url"] = "http://127.0.0.1:%d/v1/lark/sandbox/state" % server.server_port
    with open(LINK, "w") as handle: json.dump(link, handle)
    return real_call(method, body, path)
def write(path, text):
    full = os.path.join(ROOT, path); os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w").write(text)
def fresh_sandbox():
    shutil.rmtree(ROOT, ignore_errors=True)
    for path in (LINK, SAVED):
        if os.path.exists(path): os.remove(path)
def link():
    sys.argv = ["lark_state.py", "link", URL, "token-1"]; main()
out = {}
${steps}
print(json.dumps(out))
`;
    const run = spawnSync("python3", ["-c", harness], {
      input: source,
      encoding: "utf8",
    });
    expect(run.stderr).toBe(stderr);
    return JSON.parse(run.stdout.trim().split("\n").pop()!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each scenario runs a Python process and a local server, which can take a
// few seconds while the rest of the suite runs in parallel.
describe("Lark sign-in across cloud environments", { timeout: 30_000 }, () => {
  it("saves a sign-in once and restores it in the next sandbox", () => {
    const out = scenario(String.raw`
fresh_sandbox(); link()
write("config/config.json", '{"appId": "cli_a"}'); write("data/lark-cli/user.enc", "token-a")
save(); save()  # the second save has nothing new
out["puts"] = store["puts"]
fresh_sandbox(); link()
out["restored"] = open(os.path.join(ROOT, "data/lark-cli/user.enc")).read()
out["config"] = open(os.path.join(ROOT, "config/config.json")).read()
write("data/lark-cli/user.enc", "token-b"); save()  # a renewed token
out["revision"] = store["revision"]
`);
    expect(out).toEqual({
      puts: 1,
      restored: "token-a",
      config: '{"appId": "cli_a"}',
      revision: 2,
    });
  });

  it("never replaces a saved sign-in after a failed restore, and the newest write wins", () => {
    const out = scenario(
      String.raw`
fresh_sandbox(); link()
write("config/config.json", "{}"); write("data/s.enc", "old"); save()
fresh_sandbox(); store["fail"] = True
try:
    link()
except SystemExit as error:
    out["link_failed"] = error.code == 1
store["fail"] = False
write("data/other.enc", "partial"); save()
out["kept"] = store["state"] is not None and store["puts"] == 1
# Another sandbox wrote meanwhile; this one writes again on top.
fresh_sandbox(); link()
store["revision"] += 1
write("data/s.enc", "newest"); save()
fresh_sandbox(); link()
out["final"] = open(os.path.join(ROOT, "data/s.enc")).read()
# Signing out everywhere empties the saved copy.
shutil.rmtree(ROOT); os.makedirs(ROOT); save()
out["empty"] = store["state"] is None
`,
      "lark sign-in sync: HTTPError\n",
    );
    expect(out).toEqual({
      link_failed: true,
      kept: true,
      final: "newest",
      empty: true,
    });
  });

  it("keeps a sign-in made before the token arrived", () => {
    const out = scenario(String.raw`
fresh_sandbox(); os.makedirs(ROOT)
write("config/config.json", "{}"); write("data/u.enc", "local")
save()  # no token yet: nothing is sent
out["before"] = store["puts"]
link(); save()
out["after"] = store["puts"]
`);
    expect(out).toEqual({ before: 0, after: 1 });
  });

  it("gives lark-cli the user token of a connection made in the app", () => {
    const out = scenario(String.raw`
import contextlib, time
def exports():
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer): credentials()
    return buffer.getvalue()
fresh_sandbox(); link()
out["none"] = exports()
store["connection"] = {"app_id": "cli_a", "brand": "feishu", "open_id": "ou_1",
    "access_token": "u-1 'quoted'", "expires_at": (time.time() + 7200) * 1000}
out["first"] = exports()
reads = store["reads"]
exports()  # cached while far from expiry
out["cached"] = store["reads"] == reads
store["connection"] = dict(store["connection"], access_token="u-2")
with open(CREDENTIALS) as handle: cached = json.load(handle)
cached["expires_at"] = (time.time() + 60) * 1000
with open(CREDENTIALS, "w") as handle: json.dump(cached, handle)
out["renewed"] = "u-2" in exports()
store["connection"] = None
with open(CREDENTIALS, "w") as handle: json.dump(cached, handle)
out["disconnected"] = exports() == "" and not os.path.exists(CREDENTIALS)
`);
    expect(out.none).toBe("");
    expect(out.first).toBe(
      [
        "export LARKSUITE_CLI_APP_ID=cli_a",
        "export LARKSUITE_CLI_BRAND=feishu",
        `export LARKSUITE_CLI_USER_ACCESS_TOKEN='u-1 '"'"'quoted'"'"''`,
        "export LARKSUITE_CLI_DEFAULT_AS=user",
        "export LARKSUITE_CLI_STRICT_MODE=user",
        "",
      ].join("\n"),
    );
    expect(out).toMatchObject({
      cached: true,
      renewed: true,
      disconnected: true,
    });
    expect(toolingSetup).toContain("lark_state.py credentials");
  });

  it("is installed behind the lark-cli wrapper and announced by a hidden note", () => {
    expect(toolingSetup).toContain("cat > /opt/open-muse/lark_state.py");
    expect(toolingSetup).toContain(
      `export LARKSUITE_CLI_DATA_DIR=${larkStateRoot}/data`,
    );
    expect(toolingSetup).toContain("sync_state save");
    expect(toolingSetup).toContain("/opt/open-muse/lark-link");
    expect(toolingInstructions).toContain("[Open Muse Lark sign-in]");
    const note = larkStateNote(
      "https://svc.example/v1/lark/sandbox/state",
      "a'b",
    );
    expect(isLarkStateNote(note)).toBe(true);
    expect(note).toContain("/opt/open-muse/lark-link 'https://svc.example");
    expect(note).toContain("'ab'");
    expect(isLarkStateNote("Please sign me in to Lark")).toBe(false);
  });
});
