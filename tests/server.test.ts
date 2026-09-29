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
async function create(title = "一个测试任务") {
  const result = await request(app.app)
    .post("/api/sessions")
    .send({ title, category: "general" })
    .expect(201);
  return result.body.id as string;
}
describe("本地 API", () => {
  it("目标提示词中的批准要求不会被误判为发送邮件", async () => {
    const id = await create("目标规划");
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({
        type: "user.message",
        text: "帮我制定旅行计划，需要对外操作时先请求批准。",
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
  it("完整任务：创建、发送、读取事件、继续对话", async () => {
    const id = await create();
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "你好" })
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
      .send({ type: "user.message", text: "继续" })
      .expect(200);
    await vi.waitFor(() => expect(app.store.get(id)?.status).toBe("idle"));
    expect(
      app.store.data.events[id].filter((e) => e.type === "user.message"),
    ).toHaveLength(2);
  });
  it("持久保存，重建服务后可恢复历史", async () => {
    const id = await create();
    app.close();
    app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }));
    expect(
      (await request(app.app).get("/api/sessions").expect(200)).body.data[0].id,
    ).toBe(id);
  });
  it("只有当前待批准的工具可确认，重复或伪造确认被拒绝", async () => {
    const id = await create("审批测试");
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "帮我发送邮件" })
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
  it("停止演示任务，不再产生结果", async () => {
    const id = await create();
    await request(app.app)
      .post(`/api/sessions/${id}/events`)
      .send({ type: "user.message", text: "任务" })
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
  it("拒绝空消息、过长消息、任意上游事件和不存在的 Session", async () => {
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
  it("拒绝跨站来源和 DNS rebinding 的 Host", async () => {
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
  it("设置应用令牌后保护所有会话接口，config 不返回任何凭据", async () => {
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
  it("事件历史翻页没有截断", async () => {
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
  it("真实 SSE 与历史列表对同一事件使用相同 ID", async () => {
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
  it("重启时将未完成的演示任务标记为异常，而非永久运行", async () => {
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
describe("真实模式边界", () => {
  it("上游 SSE 失败返回 502，而不是提前结束成 200", async () => {
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
      title: "流测试",
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
    expect(response.body.error).toContain("事件流连接失败");
    expect(response.text).not.toContain("private-error");
  });
  it("只访问本应用创建的会话，并保存注册表", async () => {
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
      title: "任务",
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
