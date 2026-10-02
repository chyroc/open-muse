import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  aptTools,
  environmentWithTools,
  larkSkillIndex,
  larkBootstrap,
  pythonTools,
  systemWithTools,
  toolingCheck,
  toolingInstructions,
  toolingRevision,
  toolingSetup,
} from "./legacy-server/tooling";
import {
  browserDriver,
  chromeVersion,
  chromeChecksums,
  chromeDownload,
} from "./legacy-server/browser-tooling";

describe("Managed environment toolbox", () => {
  it("keeps networking, storage, secrets references and custom packages unchanged", () => {
    const config = {
      type: "cloud",
      networking: { type: "limited", allowed_hosts: ["example.com"] },
      env: { CUSTOM: "keep" },
      tos: { bucket: "example", prefix: "outputs/" },
      setup_script: "echo custom-setup",
      packages: {
        type: "packages",
        apt: ["git=1:custom", "custom-package"],
        pip: ["custom-python==1.0"],
        npm: ["custom-npm@1"],
      },
    };
    const before = structuredClone(config);
    const updated = environmentWithTools(config);
    expect(config).toEqual(before);
    expect(updated.networking).toEqual(config.networking);
    expect(updated.env).toEqual(config.env);
    expect(updated.tos).toEqual(config.tos);
    expect(updated.packages?.pip).toEqual(config.packages.pip);
    expect(updated.packages?.npm).toEqual(config.packages.npm);
    expect(updated.packages?.apt).toContain("git=1:custom");
    expect(updated.packages?.apt).not.toContain("git");
    expect(updated.setup_script).toBe("echo custom-setup\n\n" + toolingSetup);
    expect(environmentWithTools(updated)).toEqual(updated);
  });
  it("updates only its own setup block, preserving code before and after it", () => {
    const updated = environmentWithTools({
      setup_script:
        "echo before\n# BEGIN OPEN MUSE TOOLING\necho old\n# END OPEN MUSE TOOLING\necho after",
    });
    expect(updated.setup_script).toBe(
      "echo before\n" + toolingSetup + "\necho after",
    );
    expect(updated.packages).toBeUndefined();
  });
  it("refuses to overwrite malformed or duplicate managed blocks", () => {
    for (const script of [
      "# BEGIN OPEN MUSE TOOLING\ncustom",
      toolingSetup + "\n" + toolingSetup,
    ]) {
      expect(() => environmentWithTools({ setup_script: script })).toThrow(
        "malformed",
      );
    }
  });
  it("migrates the synchronous toolbox without discarding unrelated packages or custom pins", () => {
    const config = {
      type: "cloud",
      packages: {
        type: "packages",
        apt: [
          "git",
          "ffmpeg",
          "pandoc",
          "fonts-noto-cjk",
          "git=custom",
          "extra-package",
        ],
        npm: ["custom-package"],
      },
      setup_script:
        "# BEGIN OPEN MUSE TOOLING\npython -m playwright install --with-deps chromium\n# END OPEN MUSE TOOLING",
    };
    const migrated = environmentWithTools(config);
    expect(migrated.packages?.apt).toEqual(["git=custom", "extra-package"]);
    expect(migrated.packages?.npm).toEqual(["custom-package"]);
    expect(migrated.setup_script).toBe(toolingSetup);
    expect(environmentWithTools(migrated)).toEqual(migrated);
    const custom = { packages: { apt: ["git", "extra-package"] } };
    expect(environmentWithTools(custom).packages).toEqual(custom.packages);
  });
  it("preserves custom prompts and adds one updatable toolbox guide", () => {
    const first = systemWithTools("Custom instructions.");
    expect(first).toBe("Custom instructions.\n\n" + toolingInstructions);
    expect(systemWithTools(first)).toBe(first);
    expect(
      systemWithTools("Before\n<open-muse-tools>old</open-muse-tools>\nAfter"),
    ).toBe("Before\n" + toolingInstructions + "\nAfter");
    expect(first).toContain("/opt/open-muse/check");
    expect(first).toContain("Login, MFA and CAPTCHAs");
    // Blocked sites are left after two plain attempts, never worked around.
    expect(first).toContain("stop after at most two plain attempts");
    expect(first).toContain("intercept, block or rewrite its network requests");
    expect(first).toContain("disguise the browser");
    expect(first).toContain("past about 40 tool calls");
    expect(first).toContain("do not expand the scope");
  });
  it("tells the agent where deliverables must go to reach the Library", () => {
    expect(toolingInstructions).toContain(
      "Save every file the user should keep",
    );
    expect(toolingInstructions).toContain("in /mnt/session/outputs");
    expect(toolingInstructions).toContain("exported automatically");
    expect(toolingInstructions).toContain(
      "including /workspace and /tmp, are not visible",
    );
    expect(toolingInstructions).toContain("not drafts or intermediate files");
    expect(toolingInstructions).not.toContain("session outputs directory");
  });
  it("uses pinned public Python packages, an isolated interpreter, and real readiness checks", () => {
    expect(
      pythonTools.every((name) => /^[a-z0-9-]+==\d+\.\d+\.\d+$/.test(name)),
    ).toBe(true);
    expect(toolingRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(toolingSetup).toContain("https://pypi.org/simple");
    expect(toolingSetup).toContain("python3 -m venv /opt/open-muse/venv");
    expect(toolingSetup).toContain("trap finish_install EXIT");
    expect(toolingSetup).not.toMatch(/playwright|puppeteer/i);
    expect(toolingInstructions).not.toMatch(/playwright|puppeteer/i);
    expect(toolingSetup).toContain(
      "chrome-for-testing-public/" + chromeVersion,
    );
    expect(toolingSetup).toContain("--remote-debugging-address=127.0.0.1");
    expect(toolingSetup).toContain("--remote-debugging-port=0");
    expect(toolingSetup).not.toContain("--remote-allow-origins");
    expect(
      toolingSetup.indexOf("/opt/open-muse/python /opt/open-muse/check.py >"),
    ).toBeLessThan(toolingSetup.indexOf("> /opt/open-muse/revision"));
    expect(toolingCheck).toContain('browser.click("button")');
    expect(toolingCheck).toContain('startswith(b"%PDF-")');
    expect(toolingSetup).toContain("nohup bash /opt/open-muse/install.sh");
    expect(toolingSetup).toContain("exit 75");
    expect(Buffer.byteLength(toolingSetup)).toBeLessThan(256 * 1024);
    expect(toolingSetup).not.toMatch(
      /__[A-Z0-9_]+__/,
    );
  });
  it("keeps default dependencies minimal and directs optional work to task-local installs", () => {
    expect(pythonTools).toEqual(["websocket-client==1.9.2", "pyyaml==6.0.3"]);
    for (const name of [
      "ffmpeg",
      "pandoc",
      "tesseract-ocr",
      "poppler-utils",
      "fonts-noto-cjk",
      "sqlite3",
    ]) {
      expect(aptTools).not.toContain(name);
    }
    expect(aptTools).toContain("fonts-wqy-microhei");
    expect(toolingSetup).not.toMatch(
      /uv pip|matplotlib|pandas|openpyxl|tesseract|ffmpeg|pandoc/,
    );
    expect(toolingInstructions).toContain("not preinstalled");
    expect(toolingInstructions).toContain(
      "never install the entire former toolbox",
    );
    expect(toolingInstructions).toContain("task-local virtual environment");
  });
  it("pins Chrome mirror bytes to the official release and verifies before extraction", () => {
    expect(
      Object.values(chromeChecksums).every((hash) =>
        /^[a-f0-9]{64}$/.test(hash),
      ),
    ).toBe(true);
    expect(chromeDownload).toContain(
      "https://cdn.npmmirror.com/binaries/chrome-for-testing/",
    );
    expect(chromeDownload).toContain(
      "https://storage.googleapis.com/chrome-for-testing-public/",
    );
    expect(chromeDownload).toContain("sha256sum --check --status");
    expect(chromeDownload).toContain("--speed-limit 65536 --speed-time 20");
    expect(chromeDownload).toContain(
      'verify_chrome "$chrome_archive.partial" && mv',
    );
    expect(
      chromeDownload.indexOf('verify_chrome "$chrome_archive"\nunzip'),
    ).toBeGreaterThan(0);
    expect(chromeDownload).not.toMatch(/__[A-Z0-9_]+__/);
  });
  it("installs Lark CLI and indexes official skills without account authorization", () => {
    expect(toolingSetup).toContain(
      "npx --yes @larksuite/cli@latest install --lang en < /dev/null",
    );
    expect(toolingSetup).toContain("npm_config_prefix=/opt/open-muse/npm");
    expect(toolingSetup.match(/export NPM_CONFIG_PREFIX=\/opt\/open-muse\/npm/g)).toHaveLength(2);
    expect(toolingSetup).toContain("export NPM_CONFIG_REGISTRY=https://registry.npmjs.org");
    expect(toolingSetup).toContain(
      "mkdir -p /opt/open-muse/npm/bin /opt/open-muse/npm/lib/node_modules",
    );
    expect(larkBootstrap).toContain('package / "checksums.txt"');
    expect(larkBootstrap).toContain("hashlib.sha256()");
    expect(larkBootstrap).toContain(
      "https://registry.npmmirror.com/-/binary/lark-cli/",
    );
    expect(toolingSetup).toContain(
      "npm install --global @larksuite/cli@latest --ignore-scripts",
    );
    expect(
      toolingSetup.indexOf(
        "mkdir -p /opt/open-muse/npm/bin /opt/open-muse/npm/lib/node_modules\n",
      ),
    ).toBeLessThan(
      toolingSetup.indexOf("npx --yes @larksuite/cli@latest install"),
    );
    expect(toolingSetup).not.toMatch(/config init|auth login/);
    expect(larkSkillIndex).toContain('"lark-*/SKILL.md"');
    expect(larkSkillIndex).toContain('"lark-shared"');
    expect(toolingCheck).toContain('"--version"');
    expect(toolingCheck).toContain('"--help"');
    expect(toolingCheck).toContain('Path(skill["path"]).is_file()');
    expect(toolingInstructions).toContain(
      "do not assume the MA runtime auto-loads",
    );
    expect(toolingInstructions).toContain("never silently append --yes");
    expect(toolingInstructions).toContain("Installation is not authentication");
  });
  it("generates valid Bash and Python without installing anything locally", () => {
    const bash = spawnSync("bash", ["-n"], {
      input: toolingSetup,
      encoding: "utf8",
    });
    expect(bash.stderr).toBe("");
    expect(bash.status).toBe(0);
    for (const source of [
      toolingCheck,
      browserDriver,
      larkSkillIndex,
      larkBootstrap,
    ]) {
      const python = spawnSync(
        "python3",
        [
          "-c",
          "import sys; compile(sys.stdin.read(), '<tooling-check>', 'exec')",
        ],
        { input: source, encoding: "utf8" },
      );
      expect(python.stderr).toBe("");
      expect(python.status).toBe(0);
    }
  });
  it("rejects mismatched Lark mirror bytes and verifies the official fallback before extraction", () => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        String.raw`
import hashlib, json, pathlib, subprocess, sys, tempfile
source = sys.stdin.read()
original_path = pathlib.Path
original_run = subprocess.run
with tempfile.TemporaryDirectory(prefix="muse-lark-test-") as directory:
    root = original_path(directory)
    package = root / "npm/lib/node_modules/@larksuite/cli"
    package.mkdir(parents=True)
    (package / "package.json").write_text(json.dumps({"version": "1.2.3"}))
    archive_bytes = b"verified archive fixture"
    digest = hashlib.sha256(archive_bytes).hexdigest()
    (package / "checksums.txt").write_text(
        digest + "  lark-cli-1.2.3-linux-amd64.tar.gz\n" +
        digest + "  lark-cli-1.2.3-linux-arm64.tar.gz\n")
    def path(value, *parts):
        if str(value).startswith("/opt/open-muse/"):
            return root.joinpath(str(value).removeprefix("/opt/open-muse/"), *parts)
        return original_path(value, *parts)
    calls = []
    corrupt_all = False
    def run(args, **kwargs):
        calls.append(args)
        if args[0] == "curl":
            payload = b"corrupt mirror fixture" if "npmmirror" in args[-1] or corrupt_all else archive_bytes
            original_path(args[args.index("--output") + 1]).write_bytes(payload)
        elif args[0] == "tar":
            assert original_path(args[2]).read_bytes() == archive_bytes
            assert args[-1] == "lark-cli"
            original_path(args[args.index("-C") + 1], "lark-cli").write_bytes(b"binary fixture")
        else:
            raise AssertionError(args)
    pathlib.Path = path
    subprocess.run = run
    try:
        exec(source, {"__name__": "lark_bootstrap_test"})
        assert [args[0] for args in calls] == ["curl", "curl", "tar"]
        assert "npmmirror" in calls[0][-1]
        assert "github.com/larksuite/cli" in calls[1][-1]
        binary = package / "bin/lark-cli"
        assert binary.read_bytes() == b"binary fixture"
        assert binary.stat().st_mode & 0o777 == 0o755
        calls.clear()
        corrupt_all = True
        binary.unlink()
        try:
            exec(source, {"__name__": "lark_bootstrap_test"})
            raise AssertionError("Accepted mismatched archives")
        except RuntimeError as error:
            assert "verified" in str(error)
        assert [args[0] for args in calls] == ["curl", "curl"]
        assert not binary.exists()
    finally:
        pathlib.Path = original_path
        subprocess.run = original_run
`,
      ],
      { input: larkBootstrap, encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
  it("handles CDP response IDs, interleaved lifecycle events, errors and timeout boundaries", () => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        String.raw`
import json, sys, types, time
from collections import deque
sys.modules['websocket'] = types.SimpleNamespace()
namespace = {'__name__': 'muse_browser_test'}
exec(sys.stdin.read(), namespace)
Browser = namespace['Browser']
class Socket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.sent = []
    def send(self, message): self.sent.append(json.loads(message))
    def settimeout(self, value): assert value > 0
    def recv(self): return json.dumps(next(self.messages))
browser = Browser.__new__(Browser)
browser.timeout = 1
browser.sequence = 0
browser.events = deque(maxlen=256)
browser.socket = Socket([
    {'method': 'Page.lifecycleEvent', 'params': {'loaderId': 'old', 'name': 'load'}},
    {'method': 'Page.lifecycleEvent', 'params': {'loaderId': 'new', 'name': 'load'}},
    {'id': 1, 'result': {'loaderId': 'new'}},
    {'id': 2, 'result': {'result': {'value': {'title': 'test'}}}},
    {'id': 3, 'error': {'message': 'unsupported'}},
    {'id': 4, 'result': {'exceptionDetails': {'text': 'script failed'}}},
])
assert browser.navigate('https://example.com') == {'title': 'test'}
assert browser.socket.sent[0] == {'id': 1, 'method': 'Page.navigate', 'params': {'url': 'https://example.com'}}
assert len(browser.events) == 1 and browser.events[0]['params']['loaderId'] == 'old'
try:
    browser.call('Unknown.method')
    raise AssertionError('Protocol error swallowed')
except RuntimeError as error:
    assert 'unsupported' in str(error)
try:
    browser.evaluate('bad()')
    raise AssertionError('JavaScript exception swallowed')
except RuntimeError as error:
    assert 'script failed' in str(error)
try:
    browser._receive(time.monotonic() - 1)
    raise AssertionError('Missing timeout')
except TimeoutError:
    pass
`,
      ],
      { input: browserDriver, encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
  it("dispatches native CDP input, writes capture bytes, and cleans up its own process", () => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        String.raw`
import base64, json, sys, types, subprocess
sys.modules['websocket'] = types.SimpleNamespace()
namespace = {'__name__': 'muse_browser_test'}
exec(sys.stdin.read(), namespace)
Browser = namespace['Browser']
browser = Browser.__new__(Browser)
calls, files, cleanup = [], {}, []
def call(method, params=None):
    calls.append((method, params))
    if method == 'Runtime.evaluate': return {'result': {'value': {'x': 12, 'y': 34}}}
    if method == 'Page.captureScreenshot': return {'data': base64.b64encode(b'png-data').decode()}
    if method == 'Page.printToPDF': return {'data': base64.b64encode(b'pdf-data').decode()}
    return {}
browser.call = call
browser.click('button[title="hello"]')
assert calls[1:] == [('Input.dispatchMouseEvent', {'type': kind, 'button': 'left', 'clickCount': 1, 'x': 12, 'y': 34}) for kind in ['mousePressed', 'mouseReleased']]
assert json.dumps('button[title="hello"]') in calls[0][1]['expression']
namespace['Path'] = lambda path: types.SimpleNamespace(write_bytes=lambda data: files.update({path: data}))
browser.screenshot('test.png')
browser.pdf('test.pdf')
assert files == {'test.png': b'png-data', 'test.pdf': b'pdf-data'}
class Process:
    pid = 42
    def poll(self): return None
    def wait(self, timeout):
        if 'kill' not in cleanup: raise subprocess.TimeoutExpired('owned-chrome', timeout)
        cleanup.append('wait')
def killpg(pid, sig):
    assert pid == 42
    cleanup.append('kill' if sig == namespace['signal'].SIGKILL else 'terminate')
namespace['os'] = types.SimpleNamespace(killpg=killpg)
browser.process = Process()
browser.socket = types.SimpleNamespace(close=lambda: cleanup.append('socket'))
browser.log = types.SimpleNamespace(close=lambda: cleanup.append('log'))
browser.profile = types.SimpleNamespace(cleanup=lambda: cleanup.append('profile'))
browser.close()
assert cleanup == ['socket', 'terminate', 'kill', 'wait', 'kill', 'log', 'profile']
assert browser.socket is None and browser.process is None
`,
      ],
      { input: browserDriver, encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
