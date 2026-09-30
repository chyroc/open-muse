import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { ArkClient } from "../server/ark";
import { readSSE } from "../shared/sse";
import { Store } from "../server/store";
import type { AgentEvent } from "../shared/types";

let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-muse-test-"));
  app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }), {
    demoDelay: 15,
  });
});
afterEach(async () => {
  app.close();
  await rm(directory, { recursive: true, force: true });
});
async function create(title = "A test task") {
  const result = await request(app.app)
    .post("/api/sessions")
    .send({ title, category: "general" })
    .expect(201);
  return result.body.id as string;
}
describe("Local API", () => {
  it("the approval requirement in a goal prompt is not misclassified as sending an email", async () => {
    const id = await create("Goal planning");
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.message",
        text: "help me plan a trip; ask for approval before any external action",
      })
      .expect(200);
    await vi.waitFor(() => expect(app.store.get(id)?.status).toBe("idle"));
    expect(
      app.store.data.events[id].some((e) => e.type === "agent.message"),
    ).toBe(true);
    expect(app.store.data.events[id].some((e) => e.name === "send_email")).toBe(
      false,
    );
  });
  it("full task: create, send, read events, continue the conversation", async () => {
    const id = await create();
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "Hello" })
      .expect(200);
    await vi.waitFor(() => expect(app.store.get(id)?.status).toBe("idle"));
    const result = await request(app.app)
      .get(`/api/sessions/${id}/events`)
      .expect(200);
    expect(
      result.body.data.some((e: AgentEvent) => e.type === "agent.message"),
    ).toBe(true);
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "Continue" })
      .expect(200);
    await vi.waitFor(() => expect(app.store.get(id)?.status).toBe("idle"));
    expect(
      app.store.data.events[id].filter((e) => e.type === "user.message"),
    ).toHaveLength(2);
  });
  it("persists data so history survives a server rebuild", async () => {
    const id = await create();
    app.close();
    app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }));
    expect(
      (await request(app.app).get("/api/sessions").expect(200)).body.data[0].id,
    ).toBe(id);
  });
  it("only the currently pending tool can be confirmed; duplicate or forged confirmations are rejected", async () => {
    const id = await create("Approval test");
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "help me send an email" })
      .expect(200);
    await vi.waitFor(() =>
      expect(app.store.data.events[id].at(-1)?.stop_reason?.type).toBe(
        "requires_action",
      ),
    );
    const tool = app.store.data.events[id].find(
      (e) => e.type === "agent.tool_use",
    )!;
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
        tool_use_id: tool.id,
        result: "deny",
      })
      .expect(200);
    await vi.waitFor(() => expect(app.store.get(id)?.status).toBe("idle"));
    expect(
      app.store.data.events[id].some(
        (e) => e.type === "user.tool_confirmation" && e.result === "deny",
      ),
    ).toBe(true);
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.tool_confirmation",
        tool_use_id: tool.id,
        result: "allow",
      })
      .expect(409);
  });
  it("stops a demo task so it produces no more results", async () => {
    const id = await create();
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "task" })
      .expect(200);
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.interrupt" })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(
      app.store.data.events[id].filter((e) => e.type === "agent.message"),
    ).toHaveLength(0);
    expect(app.store.get(id)?.status).toBe("idle");
  });
  it("rejects empty messages, overly long messages, arbitrary upstream events, and nonexistent sessions", async () => {
    const id = await create();
    for (const body of [
      { type: "user.message", text: "  " },
      { type: "user.message", text: "x".repeat(16001) },
      { type: "system.message", content: [] },
    ]) {
      await request(app.app)
        .post(`/api/sessions/${id}/events`)
        .send(body)
        .expect(400);
    }
    await request(app.app)
      .get("/api/sessions/not-created-here/events")
      .expect(404);
    await request(app.app)
      .get(`/api/sessions/${id}/events?page=NaN`)
      .expect(400);
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
  it("once an app token is set, it protects all session endpoints and config returns no credentials", async () => {
    app.close();
    app = await createApp(
      loadConfig({
        MUSE_DATA_DIR: directory,
        MUSE_ACCESS_TOKEN: "app-private-secret",
      }),
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
      mode: "demo",
      agentConfigured: false,
      authRequired: true,
    });
    expect(JSON.stringify(config.body)).not.toContain("secret");
  });
  it("event history pagination is not truncated", async () => {
    const id = await create();
    app.store.data.events[id] = Array.from({ length: 205 }, (_, index) => ({
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
  it("real SSE and the history list use the same id for the same event", async () => {
    const id = await create();
    const server = app.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const abort = new AbortController();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/sessions/${id}/events/stream`,
        { signal: abort.signal },
      );
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const stream = readSSE(response.body!);
      const incoming = stream.next();
      const sent = await request(app.app)
        .post(`/api/sessions/${id}/events`)
        .send({ type: "user.message", text: "stream test" })
        .expect(200);
      const received = JSON.parse((await incoming).value as string);
      expect(received.id).toBe(sent.body.data[0].id);
      abort.abort();
      await stream.return(undefined);
    } finally {
      abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("on restart marks unfinished demo tasks as errored rather than permanently running", async () => {
    const id = await create();
    app.store.get(id)!.status = "running";
    await app.store.save();
    app.close();
    app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }));
    expect(app.store.get(id)!.status).toBe("idle");
    expect(app.store.data.events[id].at(-1)?.stop_reason?.type).toBe(
      "retries_exhausted",
    );
  });
});
describe("Real-mode boundaries", () => {
  it("an upstream SSE failure returns 502 instead of ending early as 200", async () => {
    app.close();
    const config = loadConfig({
      MUSE_MODE: "ark",
      MUSE_DATA_DIR: directory,
      ARK_API_KEY: "private",
      ARK_AGENT_ID: "agt-test",
      ARK_ENVIRONMENT_ID: "env-test",
    });
    const ark = new ArkClient(config);
    vi.spyOn(ark, "create").mockResolvedValue({
      id: "sesn-stream",
      title: "Stream test",
      category: "general",
      status: "idle",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    vi.spyOn(ark, "stream").mockResolvedValue(
      new Response("private-error", { status: 503 }),
    );
    app = await createApp(config, { ark });
    const id = await create();
    const response = await request(app.app)
      .get(`/api/sessions/${id}/events/stream`)
      .expect(502);
    expect(response.body.error).toContain("event stream connection failed");
    expect(response.text).not.toContain("private-error");
  });
  it("only accesses sessions created by this app and persists the registry", async () => {
    app.close();
    const config = loadConfig({
      MUSE_MODE: "ark",
      MUSE_DATA_DIR: directory,
      ARK_API_KEY: "private",
      ARK_AGENT_ID: "agt-test",
      ARK_ENVIRONMENT_ID: "env-test",
    });
    const ark = new ArkClient(config);
    vi.spyOn(ark, "create").mockResolvedValue({
      id: "sesn-test",
      title: "Task",
      category: "general",
      status: "idle",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const get = vi.spyOn(ark, "get");
    app = await createApp(config, { ark });
    await request(app.app).get("/api/sessions/foreign-session").expect(404);
    expect(get).not.toHaveBeenCalled();
    expect(await create()).toBe("sesn-test");
    const store = new Store(directory, "ark");
    await store.init();
    expect(store.get("sesn-test")).toBeTruthy();
    app.close();
    await expect(
      createApp({ ...config, arkKey: "another-account" }),
    ).rejects.toThrow("identity changed");
    await expect(
      createApp({ ...config, project: "another-project" }),
    ).rejects.toThrow("identity changed");
  });
});
