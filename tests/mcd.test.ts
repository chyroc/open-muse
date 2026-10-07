import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ArkClient } from "../shared/ark";
import { uuid } from "../shared/crypto";
import {
  MCD_MCP_URL,
  isMcdCredential,
} from "../shared/mcd";
import { LocalDatabase } from "../src/direct/storage";
import { DirectVault } from "../src/direct/vault";

type Call = { path: string; method: string; body?: Record<string, unknown> };
function fixture(vaults: Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const credentials: Record<string, unknown>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = new URL(String(input)).pathname.replace("/api/v3", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "/vaults" && method === "POST") {
      const vault = { id: "vlt-new", ...body };
      vaults.push(vault);
      return Response.json(vault);
    }
    if (path === "/vaults") return Response.json({ data: vaults });
    if (path.endsWith("/credentials") && method === "POST") {
      credentials.push({ id: `cred-${credentials.length}`, ...body });
      return Response.json({ id: "x" });
    }
    if (path.endsWith("/credentials"))
      return Response.json({ data: credentials });
    if (method === "DELETE") {
      const id = decodeURIComponent(path.split("/").pop()!);
      const at = credentials.findIndex((item) => item.id === id);
      if (at >= 0) credentials.splice(at, 1);
      return Response.json({});
    }
    return Response.json({}, { status: 404 });
  });
  const ark = new ArkClient(
    {
      arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      arkKey: "k",
      project: "",
    },
    fetcher,
  );
  const vault = new DirectVault(
    ark,
    new LocalDatabase(`vault-${uuid()}`),
    "workspace-a",
  );
  return { vault, calls, credentials };
}

describe("McDonald's MCP connection", () => {
  it("identifies only the tagged static-bearer credential", () => {
    expect(
      isMcdCredential({
        auth: { type: "static_bearer" },
        metadata: { open_muse_connector: "mcd" },
      }),
    ).toBe(true);
    expect(
      isMcdCredential({
        auth: { type: "environment_variable" },
        metadata: { open_muse_connector: "mcd" },
      }),
    ).toBe(false);
    expect(isMcdCredential({ auth: { type: "static_bearer" } })).toBe(false);
  });

  it("adds a static-bearer credential for the remote MCP and reports it", async () => {
    const f = fixture();
    expect(await f.vault.hasMcd()).toBe(false);
    await f.vault.addMcd("mcd-token");
    const posted = f.calls.find(
      (call) => call.path.endsWith("/credentials") && call.method === "POST",
    )!;
    expect(posted.body).toEqual({
      display_name: "McDonald's",
      metadata: { open_muse_connector: "mcd" },
      auth: {
        type: "static_bearer",
        mcp_server_url: MCD_MCP_URL,
        token: "mcd-token",
      },
    });
    expect(await f.vault.hasMcd()).toBe(true);
    expect(await f.vault.existing()).toBe("vlt-new");
  });

  it("replaces an existing connection instead of keeping two", async () => {
    const f = fixture();
    await f.vault.addMcd("first");
    await f.vault.addMcd("second");
    const posts = f.calls.filter(
      (call) => call.path.endsWith("/credentials") && call.method === "POST",
    );
    const deletes = f.calls.filter((call) => call.method === "DELETE");
    expect(posts).toHaveLength(2);
    expect(deletes).toHaveLength(1);
    expect(f.credentials).toHaveLength(1);
    expect((f.credentials[0].auth as { token: string }).token).toBe("second");
  });

  it("removes the connection and leaves other secrets alone", async () => {
    const f = fixture();
    await f.vault.add({ name: "GITHUB_TOKEN", value: "ghp" });
    await f.vault.addMcd("mcd-token");
    await f.vault.removeMcd();
    expect(await f.vault.hasMcd()).toBe(false);
    expect((await f.vault.list()).map((item) => item.name)).toEqual([
      "GITHUB_TOKEN",
    ]);
  });

  it("rejects an empty token before any request", async () => {
    const f = fixture();
    await expect(f.vault.addMcd("   ")).rejects.toThrow();
    expect(
      f.calls.some(
        (call) => call.path.endsWith("/credentials") && call.method === "POST",
      ),
    ).toBe(false);
  });
});
