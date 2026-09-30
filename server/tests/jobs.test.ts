import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { database } from "./database";
import { Repository } from "../src/repository";
import { processRun, tick } from "../src/jobs";
import type { Remote } from "../src/ark";
import { nextDaily, POLL_INTERVAL, RUN_DEADLINE } from "../src/schedule";
import type { AgentEvent } from "../../shared/types";

const item = {
  title: "A short walk",
  body: "Consider a short walk after lunch.",
  emoji: "🌿",
  reason: "You enjoy walking.",
  category: "Health",
  prompt: "Help me plan a walk.",
  sources: [],
};
describe("Durable background Feed", () => {
  let fixture: Awaited<ReturnType<typeof database>>, repo: Repository;
  let now: number, remote: Remote, sessions: string[], events: AgentEvent[];
  beforeAll(async () => {
    fixture = await database();
  });
  afterAll(async () => fixture.dispose());
  beforeEach(() => {
    now = Date.parse("2026-09-30T00:00:00Z");
    repo = new Repository(fixture.db, crypto.randomUUID());
    sessions = [];
    events = [];
    remote = {
      owner: repo.owner,
      fingerprint: vi.fn(async () => "connection"),
      verify: vi.fn(async () => {}),
      prepare: vi.fn(async () => "Generate a Feed"),
      create: vi.fn(async (marker) => {
        sessions.push(marker);
        return "session-1";
      }),
      find: vi.fn(async (marker) =>
        sessions.includes(marker) ? ["session-1"] : [],
      ),
      send: vi.fn(async (_id, event, prompt) => {
        events.push({
          id: event,
          type: "user.message",
          content: [{ type: "text", text: prompt }],
        });
      }),
      events: vi.fn(async () => events),
    };
  });
  const step = async () => {
    await processRun(repo, remote, () => now);
    now += POLL_INTERVAL;
  };
  const enqueue = () => repo.enqueue("manual:first-request-key", now, now);
  const finish = () =>
    events.push(
      {
        id: "reply",
        type: "agent.message",
        content: [{ type: "text", text: JSON.stringify({ items: [item] }) }],
      },
      {
        id: "idle",
        type: "session.status_idle",
        stop_reason: { type: "end_turn" },
      },
    );
  it("creates, submits, collects and exposes a real source once", async () => {
    await enqueue();
    await step();
    await step();
    finish();
    await step();
    await step();
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(remote.send).toHaveBeenCalledTimes(1);
    expect((await repo.runs())[0].phase).toBe("complete");
    const feed = await repo.feed();
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      ...item,
      session_id: "session-1",
      event_id: "reply",
    });
    expect((await repo.feed(feed.cursor)).items).toEqual([]);
    expect(
      (await new Repository(fixture.db, "another-owner").feed()).items,
    ).toEqual([]);
  });
  it("deduplicates repeated manual requests and blocks simultaneous new runs", async () => {
    const a = await enqueue();
    const b = await enqueue();
    expect(a.id).toBe(b.id);
    await expect(repo.enqueue("other-action", now, now)).rejects.toThrow(
      "Another run",
    );
  });
  it("uses a database lease across simultaneous workers", async () => {
    await enqueue();
    await Promise.all([
      processRun(repo, remote, () => now),
      processRun(repo, remote, () => now),
    ]);
    expect(remote.create).toHaveBeenCalledTimes(1);
  });
  it("recovers an ambiguous create by marker without a second creation", async () => {
    const create = remote.create;
    remote.create = vi.fn(async (marker) => {
      await create(marker);
      throw new Error("lost response");
    });
    await enqueue();
    await step();
    expect((await repo.runs())[0].phase).toBe("creating");
    await step();
    await step();
    finish();
    await step();
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(remote.send).toHaveBeenCalledTimes(1);
    expect((await repo.runs())[0].phase).toBe("complete");
  });
  it("recovers an ambiguous message from history without resending", async () => {
    const send = remote.send;
    remote.send = vi.fn(async (session, event, prompt) => {
      await send(session, event, prompt);
      throw new Error("lost ack");
    });
    await enqueue();
    await step();
    await step();
    finish();
    await step();
    expect(remote.send).toHaveBeenCalledTimes(1);
    expect((await repo.runs())[0].phase).toBe("complete");
  });
  it("never repeats a write with no history evidence, even after explicit review", async () => {
    remote.create = vi.fn(async () => {
      throw new Error("unknown");
    });
    const run = await enqueue();
    await step();
    await step();
    now += RUN_DEADLINE;
    await step();
    expect((await repo.runs())[0].phase).toBe("needs_attention");
    await repo.recheck(run.id, now);
    await step();
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect((await repo.runs())[0].phase).toBe("creating");
  });
  it("does not send to a recovered session under a different Ark connection", async () => {
    await enqueue();
    await step();
    remote.fingerprint = async () => "different";
    await step();
    expect(remote.send).not.toHaveBeenCalled();
    expect((await repo.runs())[0].phase).toBe("needs_attention");
  });
  it("requires an idle terminal event and rejects invalid generated content", async () => {
    await enqueue();
    await step();
    await step();
    events.push({
      id: "partial",
      type: "agent.message",
      content: [{ type: "text", text: "not JSON" }],
    });
    await step();
    expect((await repo.feed()).items).toEqual([]);
    events.push({ id: "idle", type: "session.status_idle" });
    await step();
    expect((await repo.runs())[0].phase).toBe("needs_attention");
    expect((await repo.feed()).items).toEqual([]);
  });
  it("requires human review instead of auto-approving tools", async () => {
    await enqueue();
    await step();
    await step();
    events.push({
      id: "idle",
      type: "session.status_idle",
      stop_reason: { type: "requires_action" },
    });
    await step();
    expect((await repo.runs())[0].phase).toBe("needs_attention");
    expect(remote.send).toHaveBeenCalledTimes(1);
  });
  it("does not start any remote work when the deployment is disabled", async () => {
    await tick(
      { DB: fixture.db, OWNER_ID: repo.owner },
      () => remote,
      () => now,
    );
    expect(remote.prepare).not.toHaveBeenCalled();
  });
  it("enforces schedule revisions and deduplicates concurrent cron ticks", async () => {
    await repo.saveSchedule(
      {
        enabled: true,
        timezone: "Asia/Shanghai",
        local_time: "09:00",
        revision: 0,
      },
      now,
    );
    await expect(
      repo.saveSchedule(
        { enabled: false, timezone: "UTC", local_time: "09:00", revision: 0 },
        now,
      ),
    ).rejects.toThrow("changed");
    now += 3600000;
    await Promise.all([repo.dispatchDue(now), repo.dispatchDue(now)]);
    expect(await repo.runs()).toHaveLength(1);
    expect((await repo.schedule()).next_run_at).toBe(now + 86400000);
  });
  it("does not dispatch a paused schedule or backfill every missed day", async () => {
    await repo.saveSchedule(
      { enabled: false, timezone: "UTC", local_time: "09:00", revision: 0 },
      now,
    );
    await repo.dispatchDue(now + 10 * 86400000);
    expect(await repo.runs()).toEqual([]);
    await repo.saveSchedule(
      { enabled: true, timezone: "UTC", local_time: "09:00", revision: 1 },
      now,
    );
    now += 10 * 86400000;
    await repo.dispatchDue(now);
    expect(await repo.runs()).toHaveLength(1);
    expect((await repo.schedule()).next_run_at).toBeGreaterThan(now);
  });
  it("limits manual and automatic runs to three per rolling day", async () => {
    for (let i = 0; i < 3; i++) {
      await repo.enqueue(`action-${i}`, now, now);
      await step();
      await step();
      finish();
      await step();
      events = [];
    }
    await expect(repo.enqueue("fourth-action", now, now)).rejects.toThrow(
      "daily limit",
    );
  });
  it("fences stale workers and preserves the current lease", async () => {
    await enqueue();
    const run = (await repo.claim(now))!;
    now += 121000;
    const newer = (await repo.claim(now))!;
    await expect(
      repo.transition(run, "queued", { phase: "creating" }, now),
    ).rejects.toThrow("lease");
    await repo.release(run, now);
    await repo.transition(newer, "queued", { phase: "creating" }, now);
    expect((await repo.runs())[0].phase).toBe("creating");
  });
});

describe("Daily local-time scheduling", () => {
  it("converts local time to UTC", () =>
    expect(
      nextDaily(Date.parse("2026-09-30T00:00:00Z"), "Asia/Shanghai", "09:00"),
    ).toBe(Date.parse("2026-09-30T01:00:00Z")));
  it("skips a nonexistent DST time", () =>
    expect(
      nextDaily(
        Date.parse("2026-03-08T05:00:00Z"),
        "America/New_York",
        "02:30",
      ),
    ).toBe(Date.parse("2026-03-09T06:30:00Z")));
  it("selects the earliest future occurrence of a repeated time", () =>
    expect(
      nextDaily(
        Date.parse("2026-11-01T04:00:00Z"),
        "America/New_York",
        "01:30",
      ),
    ).toBe(Date.parse("2026-11-01T05:30:00Z")));
  it("rejects invalid zones and times", () => {
    expect(() => nextDaily(0, "invalid/zone", "09:00")).toThrow();
    expect(() => nextDaily(0, "UTC", "25:00")).toThrow();
  });
});
