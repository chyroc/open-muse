import { describe, it, expect, vi } from "vitest";
import { ArkRemote } from "../src/ark";
import type { Env } from "../src/env";

const env = {
  OWNER_ID: "test",
  ARK_API_KEY: "test-ark-private-key",
  ARK_PROJECT: "test-project",
  ARK_AGENT_ID: "agent-test",
  ARK_AGENT_VERSION: "1",
  ARK_ENVIRONMENT_ID: "env-test",
  ARK_MEMORY_STORE_ID: "mem-test",
} as Env;
function fixture(
  options: { tools?: unknown[]; version?: number; duplicate?: boolean } = {},
) {
  const calls: {
    url: string;
    method: string;
    body?: Record<string, unknown>;
  }[] = [];
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = String(input),
      path = new URL(url).pathname;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    expect(url.startsWith("https://ark.cn-beijing.volces.com/api/v3/")).toBe(
      true,
    );
    expect(init?.redirect).toBe("error");
    let result: unknown;
    if (path.endsWith("/agents/agent-test"))
      result = {
        id: "agent-test",
        version: options.version ?? 1,
        tools: options.tools ?? [],
      };
    else if (path.endsWith("/memories"))
      result = {
        data: [
          { id: "doc-feed", path: "/FEED.md" },
          ...(options.duplicate ? [{ id: "doc-other", path: "/FEED.md" }] : []),
        ],
      };
    else if (path.endsWith("/doc-feed"))
      result = {
        path: "/FEED.md",
        content:
          "Interesting ideas, with test-ark-private-key accidentally pasted.",
      };
    else if (path.endsWith("/sessions") && init?.method === "POST")
      result = { id: "session-new" };
    else result = { data: [] };
    return Response.json(result);
  });
  return { remote: new ArkRemote(env, fetcher), calls, fetcher };
}
describe("Constrained MA adapter", () => {
  it("rejects tools and changed agent versions before creating a session", async () => {
    for (const options of [
      { tools: [{ type: "agent_toolset_20260401" }] },
      { version: 2 },
    ]) {
      const f = fixture(options);
      await expect(f.remote.prepare()).rejects.toThrow("no-tools agent");
      expect(f.calls.every((c) => c.method === "GET")).toBe(true);
    }
  });
  it("reads authorized context without writing memory and redacts the configured key", async () => {
    const f = fixture();
    const prompt = await f.remote.prepare();
    expect(prompt).toContain("Interesting ideas");
    expect(prompt).toContain("no tools");
    expect(prompt).not.toContain(env.ARK_API_KEY);
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("does not mount memory or credential vaults in the background session", async () => {
    const f = fixture();
    await f.remote.create("unique-marker");
    expect(f.calls.at(-1)?.body).toEqual({
      agent: "agent-test",
      environment_id: "env-test",
      title: "unique-marker",
      resources: [],
      vault_ids: [],
    });
  });
  it("checks policy again before submitting the stable event ID", async () => {
    const f = fixture();
    await f.remote.send("session-new", "event-stable", "prompt");
    expect(f.calls.at(-2)?.url).toContain("/agents/agent-test");
    expect(f.calls.at(-1)?.body).toMatchObject({
      events: [{ id: "event-stable", type: "user.message" }],
    });
  });
  it("fails closed on duplicate memory documents", async () => {
    await expect(fixture({ duplicate: true }).remote.prepare()).rejects.toThrow(
      "Duplicate",
    );
  });
  it("never accepts an arbitrary resource URL", async () => {
    expect(() => fixture().remote.events("https://evil.example/key")).toThrow(
      "invalid",
    );
  });
});
