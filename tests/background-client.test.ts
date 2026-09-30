import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { BackgroundClient } from "../src/background-client";
import { backgroundOrigin } from "../shared/background-origin";
import {
  backgroundCredentials,
  credentials,
  LocalDatabase,
} from "../src/direct/storage";

const token = "muse_device_" + "a".repeat(40);
const status = {
  connected: true,
  owner: "private-owner",
  backgroundReady: true,
  schedule: {
    enabled: false,
    timezone: "UTC",
    local_time: "09:00",
    next_run_at: null,
    revision: 0,
  },
};
const run = {
  id: "run-one",
  phase: "queued",
  session_id: null,
  error: null,
  created_at: 1,
  scheduled_for: 1,
};
const post = {
  id: "post-one",
  sequence: 1,
  session_id: "session-one",
  event_id: "event-one",
  created_at: 1,
  title: "A quiet walk",
  body: "Try a short walk.",
  emoji: "🌿",
  reason: "You like walking.",
  category: "Health",
  prompt: "Help me plan a walk.",
  sources: [],
};
function fixture() {
  let value = "";
  const vault = {
    read: vi.fn(async () => value),
    write: vi.fn(async (v: string) => {
      value = v;
    }),
  };
  const db = new LocalDatabase(`background-test-${crypto.randomUUID()}`);
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`,
    );
    if (url.pathname === "/v1/status") return Response.json(status);
    if (url.pathname === "/v1/runs")
      return Response.json(init?.method === "POST" ? run : { runs: [run] });
    if (url.pathname === "/v1/feed")
      return Response.json({
        items: url.searchParams.get("after") === "0" ? [post] : [],
        cursor: 1,
        hasMore: false,
      });
    return Response.json({ ...status.schedule, revision: 1 });
  });
  const client = new BackgroundClient(
    "https://background.example",
    vault,
    db,
    fetcher,
  );
  return { client, vault, db, fetcher, read: () => value };
}
describe("Optional native background client", () => {
  it("does no networking when the build has no service", async () => {
    const f = fixture();
    const c = new BackgroundClient("", f.vault, f.db, f.fetcher);
    await c.restore();
    expect(c.configured()).toBe(false);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.vault.read).not.toHaveBeenCalled();
  });
  it("only accepts explicit HTTPS origins", () => {
    for (const origin of [
      "http://example.com",
      "https://*.example.com",
      "https://u:p@example.com",
      "https://example.com/path",
      "https://example.com?key=private",
      "https://example.com/#fragment",
    ])
      expect(() => backgroundOrigin(origin)).toThrow();
    expect(backgroundOrigin("https://background.example/")).toBe(
      "https://background.example",
    );
  });
  it("rejects Cloudflare and Ark keys before network access", async () => {
    const f = fixture();
    await expect(f.client.connect("cfat_not-a-device-token")).rejects.toThrow(
      "not an Ark or Cloudflare",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("verifies the owner before storing a device token", async () => {
    const f = fixture();
    await f.client.connect(token);
    expect(JSON.parse(f.read())).toEqual({
      origin: "https://background.example",
      owner: "private-owner",
      token,
    });
  });
  it("restores Keychain state but will not send credentials to another origin", async () => {
    const f = fixture();
    await f.client.connect(token);
    const c = new BackgroundClient(
      "https://other.example",
      f.vault,
      f.db,
      f.fetcher,
    );
    await expect(c.restore()).rejects.toThrow("does not match");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not upload keys into IndexedDB; caches only scoped Feed content", async () => {
    const f = fixture();
    await f.client.connect(token);
    const result = await f.client.refresh();
    expect(result.items).toEqual([post]);
    expect(JSON.stringify(await f.client.cachedFeed())).not.toContain(token);
    const c = new BackgroundClient(
      "https://background.example",
      f.vault,
      f.db,
      f.fetcher,
    );
    await c.restore();
    expect((await c.cachedFeed()).items).toEqual([post]);
    expect((await c.refresh()).items).toHaveLength(1);
  });
  it("persists an operation ID before POST and reuses it after a lost response and relaunch", async () => {
    const f = fixture();
    await f.client.connect(token);
    const keys: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      if (init?.method === "POST") {
        expect(JSON.parse(f.read()).pending).toBeTruthy();
        keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
        if (keys.length === 1) throw new Error("secret-upstream-text");
        return Response.json(run);
      }
      return f.fetcher(input, init);
    });
    const c = new BackgroundClient(
      "https://background.example",
      f.vault,
      f.db,
      fetcher,
    );
    await c.restore();
    await expect(c.generate()).rejects.toThrow(
      "no request was retried automatically",
    );
    const restarted = new BackgroundClient(
      "https://background.example",
      f.vault,
      f.db,
      fetcher,
    );
    await restarted.restore();
    await restarted.generate();
    expect(keys[0]).toBe(keys[1]);
    expect(JSON.parse(f.read()).pending).toBeUndefined();
  });
  it("does not POST if saving the pending ID fails", async () => {
    const f = fixture();
    await f.client.connect(token);
    f.vault.write.mockRejectedValue(new Error("Keychain locked"));
    await expect(f.client.generate()).rejects.toThrow("Keychain locked");
    expect(f.client.pending()).toBe(false);
    expect(
      vi
        .mocked(f.fetcher)
        .mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });
  it("fails closed when a deployment changes owners", async () => {
    const f = fixture();
    await f.client.connect(token);
    vi.mocked(f.fetcher).mockResolvedValue(
      Response.json({ ...status, owner: "another-owner" }),
    );
    await expect(f.client.status()).rejects.toThrow("owner changed");
  });
  it("disconnects locally without touching a schedule or MA", async () => {
    const f = fixture();
    await f.client.connect(token);
    await f.client.disconnect();
    expect(f.read()).toBe("");
    expect(f.client.connected()).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps a schedule revision and never retries a failed write", async () => {
    const f = fixture();
    await f.client.connect(token);
    await f.client.saveSchedule({ ...status.schedule, enabled: true });
    const write = vi
      .mocked(f.fetcher)
      .mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(write[1]?.body))).toEqual({
      enabled: true,
      timezone: "UTC",
      local_time: "09:00",
      revision: 0,
      confirm: true,
    });
  });
  it("uses separate native Keychain namespaces for background and Ark", async () => {
    const postMessage = vi.fn(async () => "");
    vi.stubGlobal("webkit", {
      messageHandlers: { museCredentials: { postMessage } },
    });
    try {
      await backgroundCredentials.write("test-background-value");
      await credentials.read();
      expect(postMessage.mock.calls[0]).toEqual([
        {
          operation: "write",
          value: "test-background-value",
          namespace: "background",
        },
      ]);
      expect(postMessage.mock.calls[1]).toEqual([
        { operation: "read", value: "" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
