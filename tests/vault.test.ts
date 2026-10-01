import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ArkClient } from "../shared/ark";
import { uuid } from "../shared/crypto";
import { LocalDatabase } from "../src/direct/storage";
import { DirectVault } from "../src/direct/vault";

type Call = { path: string; method: string; body?: Record<string, unknown> };
function fixture(vaults: Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const credentials: Record<string, unknown>[] = [];
  let failCreate = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = new URL(String(input)).pathname.replace("/api/v3", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "/vaults" && method === "POST") {
      const vault = { id: "vlt-new", ...body };
      vaults.push(vault);
      if (failCreate) return Response.json({}, { status: 504 });
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
      credentials.splice(0, 1);
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
  return { vault, calls, ark, fetcher, failNext: () => (failCreate = true) };
}

describe("Secure storage vault", () => {
  it("reads nothing into existence and lists nothing without a vault", async () => {
    const f = fixture();
    expect(await f.vault.existing()).toBeUndefined();
    expect(await f.vault.list()).toEqual([]);
    expect(f.calls.some((call) => call.method === "POST")).toBe(false);
  });
  it("creates one tagged vault on the first secret and injects it by name", async () => {
    const f = fixture([
      { id: "vlt-foreign", metadata: { open_muse_workspace: "someone-else" } },
    ]);
    const list = await f.vault.add({
      name: "GITHUB_TOKEN",
      value: "ghp_secret",
      hosts: ["api.github.com"],
    });
    const created = f.calls.find(
      (call) => call.path === "/vaults" && call.method === "POST",
    )!;
    expect(created.body).toEqual({
      display_name: "Open Muse secure storage",
      metadata: { open_muse_workspace: "workspace-a" },
    });
    const credential = f.calls.find(
      (call) => call.path.endsWith("/credentials") && call.method === "POST",
    )!;
    expect(credential.path).toBe("/vaults/vlt-new/credentials");
    expect(credential.body).toEqual({
      display_name: "GITHUB_TOKEN",
      auth: {
        type: "environment_variable",
        secret_name: "GITHUB_TOKEN",
        secret_value: "ghp_secret",
        networking: { type: "limited", allowed_hosts: ["api.github.com"] },
      },
    });
    expect(list.map((item) => item.name)).toEqual(["GITHUB_TOKEN"]);
    expect(await f.vault.existing()).toBe("vlt-new");
  });
  it("adopts its own vault instead of creating another after an unclear result", async () => {
    const f = fixture();
    f.failNext();
    await expect(
      f.vault.add({ name: "API_KEY", value: "v" }),
    ).rejects.toThrow();
    // The vault was created even though the answer was lost; the next add
    // finds it by its tag and does not create a second one.
    await f.vault.add({ name: "API_KEY", value: "v" });
    expect(
      f.calls.filter(
        (call) => call.path === "/vaults" && call.method === "POST",
      ),
    ).toHaveLength(1);
    expect(await f.vault.existing()).toBe("vlt-new");
  });
  it("rejects invalid names, hosts and values before any request", async () => {
    const f = fixture();
    for (const input of [
      { name: "1BAD", value: "v" },
      { name: "OK", value: "" },
      { name: "OK", value: "v", hosts: ["https://example.com/path"] },
    ])
      await expect(f.vault.add(input)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("passes vault ids only when a session should get them", async () => {
    const f = fixture();
    const created: Record<string, unknown>[] = [];
    f.fetcher.mockImplementation(async (_input, init) => {
      created.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "sesn-1" });
    });
    await f.ark.create("A", "general", { agent: "a", environment_id: "e" });
    await f.ark.create("B", "general", {
      agent: "a",
      environment_id: "e",
      vault_ids: ["vlt-1"],
    });
    expect(created[0]).not.toHaveProperty("vault_ids");
    expect(created[1].vault_ids).toEqual(["vlt-1"]);
  });
});
