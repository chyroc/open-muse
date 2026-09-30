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
  content: [
    { type: "text", text: "# Completed result\n\nThis is the source reply." },
  ],
};
async function session() {
  const response = await request(instance.app)
    .post("/api/sessions")
    .send({ title: "Source material" })
    .expect(201);
  instance.store.data.events[response.body.id] = [agentEvent];
  await instance.store.save();
  return response.body.id as string;
}

describe("Goals and library", () => {
  it("returns empty lists when old data lacks the new fields", async () => {
    expect((await request(instance.app).get("/api/goals")).body.data).toEqual(
      [],
    );
    expect((await request(instance.app).get("/api/library")).body.data).toEqual(
      [],
    );
  });
  it("creates, updates steps, pauses, completes a goal, and restores it after restart", async () => {
    const { body: goal } = await request(instance.app)
      .post("/api/goals")
      .send({ title: "  Weekend trip  ", description: "Two days" })
      .expect(201);
    expect(goal.title).toBe("Weekend trip");
    const steps = [{ id: "one", title: "Choose dates", done: true }];
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
    ).toMatchObject({ title: "Weekend trip", status: "completed", steps });
  });
  it("a goal can only be linked to a session registered in the current space", async () => {
    const id = await session();
    const { body: goal } = await request(instance.app)
      .post("/api/goals")
      .send({ title: "Goal" });
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
  it("rejects invalid goals, duplicate steps, and unknown goals", async () => {
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
      .send({ title: "Goal" });
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ status: "automatic" })
      .expect(400);
    const step = { id: "same", title: "A step", done: false };
    await request(instance.app)
      .post(`/api/goals/${goal.id}`)
      .send({ steps: [step, step] })
      .expect(400);
  });
  it("saves a real reply and ignores forged text; repeats are idempotent and survive restart", async () => {
    const id = await session();
    const response = await request(instance.app)
      .post("/api/library")
      .send({ session_id: id, event_id: "answer", text: "Forged content" })
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
  it("cannot save sessions from another space, unknown events, or user input", async () => {
    const id = await session();
    instance.store.data.events[id].push({
      id: "user",
      type: "user.message",
      content: [{ type: "text", text: "Input" }],
    });
    for (const input of [
      { session_id: "foreign", event_id: "answer" },
      { session_id: id, event_id: "missing" },
      { session_id: id, event_id: "user" },
    ]) {
      await request(instance.app).post("/api/library").send(input).expect(404);
    }
  });
  it("new endpoints remain protected by the access token", async () => {
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

describe("MA source validation", () => {
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
      title: "MA result",
      status: "idle",
      category: "general",
      created_at: "2026-09-29",
      updated_at: "2026-09-29",
    } as Session);
    return ark;
  }
  it("reads MA history page by page before saving; concurrent requests save only one copy", async () => {
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
  it("detects a looping cursor without hanging or saving nonexistent results", async () => {
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
