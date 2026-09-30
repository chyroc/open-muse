import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { ApiError } from "../server/ark";
import { readSSE } from "../shared/sse";
import { Store } from "../server/store";
import { arkFixture } from "./helpers/ark-fixture";

let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
let fixture: ReturnType<typeof arkFixture>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-muse-test-"));
  fixture = arkFixture(directory);
  app = await createApp(fixture.config, { ark: fixture.ark });
});
afterEach(async () => {
  app.close();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
async function create(title = "A test task") {
  const result = await request(app.app)
    .post("/api/sessions")
    .send({ title, category: "general" })
    .expect(201);
  return result.body.id as string;
}
describe("Real conversation API", () => {
  it("creates, sends and continues exclusively through the Ark adapter", async () => {
    const id = await create();
    for (const text of ["Hello", "Continue"])
      await request(app.app)
        .post(`/api/sessions/${id}/events`)
        .send({ type: "user.message", text })
        .expect(200);
    const result = await request(app.app)
      .get(`/api/sessions/${id}/events`)
      .expect(200);
    expect(result.body.data).toEqual(fixture.history[id]);
    expect(fixture.ark.create).toHaveBeenCalledOnce();
    expect(fixture.ark.send).toHaveBeenCalledTimes(2);
    expect(fixture.ark.send).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({
        type: "user.message",
        content: [{ type: "text", text: "Continue" }],
      }),
    );
    expect(app.store.data.events[id]).toBeUndefined();
  });
  it("preserves the session registry across a server restart", async () => {
    const id = await create();
    app.close();
    app = await createApp(fixture.config, { ark: fixture.ark });
    expect(
      (await request(app.app).get("/api/sessions").expect(200)).body.data[0].id,
    ).toBe(id);
  });
  it("rejects duplicate or forged confirmations using current upstream history", async () => {
    const id = await create();
    fixture.history[id] = [
      {
        id: "tool",
        type: "agent.tool_use",
        name: "send_email",
        evaluated_permission: "ask",
        input: {},
      },
      {
        id: "idle",
        type: "session.status_idle",
        stop_reason: { type: "requires_action", event_ids: ["tool"] },
      },
    ];
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.tool_confirmation",
        tool_use_id: "forged",
        result: "allow",
      })
      .expect(409);
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.tool_confirmation",
        tool_use_id: "tool",
        result: "deny",
      })
      .expect(200);
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.tool_confirmation",
        tool_use_id: "tool",
        result: "allow",
      })
      .expect(409);
    expect(fixture.ark.send).toHaveBeenCalledOnce();
  });
  it("forwards interruption to Ark", async () => {
    const id = await create();
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.interrupt" })
      .expect(200);
    expect(fixture.ark.send).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ type: "user.interrupt" }),
    );
  });
  it("rejects invalid messages and unregistered sessions before calling Ark", async () => {
    const id = await create();
    for (const body of [
      { type: "user.message", text: "  " },
      { type: "user.message", text: "x".repeat(16001) },
      { type: "system.message", content: [] },
    ])
      await request(app.app)
        .post(`/api/sessions/${id}/events`)
        .send(body)
        .expect(400);
    await request(app.app)
      .get("/api/sessions/not-created-here/events")
      .expect(404);
    await request(app.app)
      .get(`/api/sessions/${id}/events?page=${"x".repeat(2049)}`)
      .expect(400);
    expect(fixture.ark.send).not.toHaveBeenCalled();
    expect(fixture.ark.events).not.toHaveBeenCalled();
  });
  it("rejects cross-site origins and DNS-rebinding Host headers", async () => {
    await request(app.app)
      .get("/api/sessions")
      .set("Origin", "https://evil.example")
      .expect(403);
    await request(app.app)
      .get("/api/sessions")
      .set("Host", "evil.example")
      .expect(403);
    await request(app.app)
      .options("/api/sessions")
      .set("Origin", "http://127.0.0.1:4310")
      .expect(204);
  });
  it("requires the app access token and never includes credentials in config", async () => {
    app.close();
    app = await createApp(
      { ...fixture.config, accessToken: "app-private-secret" },
      { ark: fixture.ark },
    );
    await request(app.app).get("/api/sessions").expect(401);
    await request(app.app)
      .get("/api/sessions")
      .set("Authorization", "Bearer wrong")
      .expect(401);
    await request(app.app)
      .get("/api/sessions")
      .set("Authorization", "Bearer app-private-secret")
      .expect(200);
    const config = await request(app.app).get("/api/config").expect(200);
    expect(config.body).toEqual({
      mode: "ark",
      agentConfigured: true,
      authRequired: true,
    });
    expect(config.text).not.toContain("secret");
  });
  it("forwards event pagination without truncation", async () => {
    const id = await create();
    fixture.history[id] = Array.from({ length: 205 }, (_, index) => ({
      id: String(index),
      type: "agent.thinking",
    }));
    const first = await request(app.app)
      .get(`/api/sessions/${id}/events`)
      .expect(200);
    const second = await request(app.app)
      .get(`/api/sessions/${id}/events?page=${first.body.next_page}`)
      .expect(200);
    expect(first.body.data.length + second.body.data.length).toBe(205);
    expect(second.body.next_page).toBeUndefined();
  });
  it("forwards the same upstream event IDs in SSE and history", async () => {
    const id = await create();
    const sent = await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "stream test" })
      .expect(200);
    const server = app.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/sessions/${id}/events/stream`,
      );
      const incoming = [];
      for await (const event of readSSE(response.body!))
        incoming.push(JSON.parse(event));
      expect(incoming[0].id).toBe(sent.body.data[0].id);
      expect(incoming).toEqual(fixture.history[id]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("reports upstream failures without a simulated response or local replacement session", async () => {
    vi.mocked(fixture.ark.create).mockRejectedValueOnce(
      new ApiError(502, "Ark is unavailable."),
    );
    await request(app.app)
      .post("/api/sessions")
      .send({ title: "Failed task" })
      .expect(502);
    expect(app.store.data.sessions).toHaveLength(0);
    const id = await create();
    vi.mocked(fixture.ark.send).mockRejectedValueOnce(
      new ApiError(502, "Ark is unavailable."),
    );
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "Hello" })
      .expect(502);
    expect(fixture.history[id]).toEqual([]);
    expect(app.store.data.events).toEqual({});
  });
  it("returns 502 for an upstream SSE failure instead of an empty successful stream", async () => {
    const id = await create();
    vi.mocked(fixture.ark.stream).mockResolvedValueOnce(
      new Response("private-error", { status: 503 }),
    );
    const response = await request(app.app)
      .get(`/api/sessions/${id}/events/stream`)
      .expect(502);
    expect(response.body.error).toContain("event stream connection failed");
    expect(response.text).not.toContain("private-error");
  });
  it("only accesses registered sessions and refuses to reuse another account's registry", async () => {
    await request(app.app).get("/api/sessions/foreign-session").expect(404);
    expect(fixture.ark.get).not.toHaveBeenCalled();
    const id = await create();
    const store = new Store(directory, "ark");
    await store.init();
    expect(store.get(id)).toBeTruthy();
    app.close();
    await expect(
      createApp({ ...fixture.config, arkKey: "another-account" }),
    ).rejects.toThrow("identity changed");
    await expect(
      createApp({ ...fixture.config, project: "another-project" }),
    ).rejects.toThrow("identity changed");
  });
});
describe("Signed-out boundaries", () => {
  it("keeps old demo files untouched and inaccessible, and requires real credentials for all actions", async () => {
    const legacy = new Store(directory, "demo");
    legacy.data.sessions.push({
      id: "demo-old",
      title: "Old simulated task",
      category: "general",
      status: "idle",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });
    await legacy.save();
    app.close();
    app = await createApp(
      loadConfig({ MUSE_MODE: "demo", MUSE_DATA_DIR: directory }),
    );
    expect(
      (await request(app.app).get("/api/config").expect(200)).body.mode,
    ).toBe("disconnected");
    expect(
      (await request(app.app).get("/api/workspace").expect(200)).body.state,
    ).toBe("disconnected");
    for (const path of ["/sessions", "/goals", "/library"])
      expect(
        (await request(app.app).get(`/api${path}`).expect(200)).body.data,
      ).toEqual([]);
    for (const [path, body] of [
      ["/sessions", { title: "No simulated task" }],
      [
        "/sessions/demo-old/events",
        { type: "user.message", text: "No simulated reply" },
      ],
      ["/goals", { title: "No anonymous goal" }],
      ["/library", { session_id: "demo-old", event_id: "answer" }],
      ["/workspace/prepare", {}],
    ] as const)
      await request(app.app).post(`/api${path}`).send(body).expect(401);
    await request(app.app).get("/api/sessions/demo-old/events").expect(401);
    await request(app.app)
      .get("/api/sessions/demo-old/events/stream")
      .expect(401);
    expect(app.store.data.sessions).toEqual([]);
    const preserved = new Store(directory, "demo");
    await preserved.init();
    expect(preserved.get("demo-old")).toBeTruthy();
  });
});
