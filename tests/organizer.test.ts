import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { ArkClient } from "../server/ark";
import type { AgentEvent, Session } from "../shared/types";

let directory: string;
let instance: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-muse-organizer-"));
  instance = await createApp(loadConfig({ MUSE_DATA_DIR: directory }), {
    demoDelay: 5,
  });
});
afterEach(async () => {
  instance.close();
  await rm(directory, { recursive: true, force: true });
});
const agentEvent: AgentEvent = {
  id: "answer",
  type: "agent.message",
  content: [{ type: "text", text: "# 已完成的结果\n\n这是来源回复。" }],
};
async function session() {
  const response = await request(instance.app)
    .post("/api/sessions")
    .send({ title: "资料来源" })
    .expect(201);
  instance.store.data.events[response.body.id] = [agentEvent];
  await instance.store.save();
  return response.body.id as string;
}

describe("目标与资料库", () => {
  it("旧数据没有新增字段时返回空列表", async () => {
    expect((await request(instance.app).get("/api/goals")).body.data).toEqual(
      [],
    );
    expect((await request(instance.app).get("/api/library")).body.data).toEqual(
      [],
    );
  });
  it("创建、更新步骤、暂停、完成并在重启后恢复目标", async () => {
    const { body: goal } = await request(instance.app)
      .post("/api/goals")
      .send({ title: "  周末旅行  ", description: "两天" })
      .expect(201);
    expect(goal.title).toBe("周末旅行");
    const steps = [{ id: "one", title: "确定日期", done: true }];
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ steps, status: "paused" })
      .expect(200);
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ status: "completed" })
      .expect(200);
    instance.close();
    instance = await createApp(loadConfig({ MUSE_DATA_DIR: directory }));
    expect(
      (await request(instance.app).get("/api/goals")).body.data[0],
    ).toMatchObject({ title: "周末旅行", status: "completed", steps });
  });
  it("目标只能关联当前空间登记过的会话", async () => {
    const id = await session();
    const { body: goal } = await request(instance.app)
      .post("/api/goals")
      .send({ title: "目标" });
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ session_id: "someone-elses-session" })
      .expect(404);
    const response = await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ session_id: id })
      .expect(200);
    expect(response.body.session_id).toBe(id);
  });
  it("拒绝无效目标、重复步骤和未知目标", async () => {
    await request(instance.app)
      .post("/api/goals")
      .send({ title: " " })
      .expect(400);
    await request(instance.app)
      .post("/api/goals/missing")
      .send({ status: "completed" })
      .expect(404);
    const { body: goal } = await request(instance.app)
      .post("/api/goals")
      .send({ title: "目标" });
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ status: "automatic" })
      .expect(400);
    const step = { id: "same", title: "一步", done: false };
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ steps: [step, step] })
      .expect(400);
  });
  it("收藏真实回复，忽略伪造正文；重复收藏幂等且重启后保留", async () => {
    const id = await session();
    const response = await request(instance.app)
      .post("/api/library")
      .send({ session_id: id, event_id: "answer", text: "伪造内容" })
      .expect(201);
    expect(response.body.text).toBe(agentEvent.content![0].text);
    const repeat = await request(instance.app)
      .post("/api/library")
      .send({ session_id: id, event_id: "answer" })
      .expect(200);
    expect(repeat.body.id).toBe(response.body.id);
    instance.close();
    instance = await createApp(loadConfig({ MUSE_DATA_DIR: directory }));
    expect(
      (await request(instance.app).get("/api/library")).body.data,
    ).toHaveLength(1);
  });
  it("不能收藏其他空间的会话、未知事件或用户输入", async () => {
    const id = await session();
    instance.store.data.events[id].push({
      id: "user",
      type: "user.message",
      content: [{ type: "text", text: "输入" }],
    });
    for (const input of [
      { session_id: "foreign", event_id: "answer" },
      { session_id: id, event_id: "missing" },
      { session_id: id, event_id: "user" },
    ]) {
      await request(instance.app).post("/api/library").send(input).expect(404);
    }
  });
  it("新增接口仍受访问令牌保护", async () => {
    instance.close();
    instance = await createApp(
      loadConfig({
        MUSE_DATA_DIR: directory,
        MUSE_ACCESS_TOKEN: "app-test-access",
      }),
    );
    await request(instance.app).get("/api/goals").expect(401);
    await request(instance.app)
      .post("/api/library")
      .send({ session_id: "foreign", event_id: "event" })
      .expect(401);
    await request(instance.app)
      .get("/api/library")
      .set("Authorization", "Bearer app-test-access")
      .expect(200);
  });
});

describe("MA 资料来源校验", () => {
  async function arkApp() {
    instance.close();
    const config = loadConfig({
      MUSE_DATA_DIR: directory,
      MUSE_MODE: "ark",
      ARK_API_KEY: "test-not-a-real-key",
    });
    const ark = new ArkClient(config);
    instance = await createApp(config, { ark });
    instance.store.data.sessions.push({
      id: "registered",
      title: "MA 结果",
      status: "idle",
      category: "general",
      created_at: "2026-09-29",
      updated_at: "2026-09-29",
    } as Session);
    return ark;
  }
  it("逐页读取 MA 历史后收藏，并发请求只保存一份", async () => {
    const ark = await arkApp();
    vi.spyOn(ark, "events").mockImplementation(async (_id, page) =>
      page ? { data: [agentEvent] } : { data: [], next_page: "page-2" },
    );
    const save = () =>
      request(instance.app)
        .post("/api/library")
        .send({ session_id: "registered", event_id: "answer" });
    const results = await Promise.all([save(), save()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(ark.events).toHaveBeenCalledWith("registered", "page-2");
    expect(instance.store.data.library).toHaveLength(1);
  });
  it("检测循环游标，不会卡死或保存不存在的结果", async () => {
    const ark = await arkApp();
    vi.spyOn(ark, "events").mockResolvedValue({ data: [], next_page: "loop" });
    await request(instance.app)
      .post("/api/library")
      .send({ session_id: "registered", event_id: "missing" })
      .expect(502);
    expect(ark.events).toHaveBeenCalledTimes(2);
    expect(instance.store.data.library ?? []).toHaveLength(0);
  });
});
