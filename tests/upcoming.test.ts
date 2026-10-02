import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { t } from "../shared/i18n";
import { identityInstructions } from "../shared/identity";
import {
  deliveredOccurrences,
  describeSchedule,
  isReminderPrompt,
  isoTime,
  reminderBatch,
  dueOccurrence,
  emptyUpcomingDocument,
  nextOccurrence,
  occurrences,
  parseUpcoming,
  reminderPrompt,
  serializeUpcoming,
  upcomingInstructions,
  type UpcomingDelivery,
  type UpcomingItem,
} from "../shared/upcoming";
import type { AgentEvent, Session } from "../shared/types";
import { DirectUpcoming } from "../src/direct/upcoming";
import { LocalDatabase } from "../src/direct/storage";

const hour = 3600000;
const item = (patch: Partial<UpcomingItem> = {}): UpcomingItem => ({
  id: "timesheet",
  title: "Submit timesheet",
  instruction: "Remind me to submit my timesheet.",
  schedule: { kind: "weekly", days: [1], time: "09:00" },
  time_zone: "America/Los_Angeles",
  status: "active",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...patch,
});

describe("Upcoming schedules", () => {
  it("computes local occurrences across time zones and DST", () => {
    const daily = item({ schedule: { kind: "daily", time: "09:00" } });
    // 09:00 PDT is 16:00 UTC; 09:00 PST is 17:00 UTC.
    expect(
      occurrences(
        daily,
        Date.parse("2026-11-01T00:00:00Z"),
        Date.parse("2026-11-03T00:00:00Z"),
      ).map((at) => new Date(at).toISOString()),
    ).toEqual(["2026-11-01T17:00:00.000Z", "2026-11-02T17:00:00.000Z"]);
    // 02:30 does not exist on the spring-forward day and is skipped.
    const skipped = item({ schedule: { kind: "daily", time: "02:30" } });
    expect(
      occurrences(
        skipped,
        Date.parse("2027-03-14T00:00:00Z"),
        Date.parse("2027-03-15T23:00:00Z"),
      ).map((at) => new Date(at).toISOString()),
    ).toEqual(["2027-03-15T09:30:00.000Z"]);
    // A repeated hour fires once, at its first occurrence.
    const repeated = item({ schedule: { kind: "daily", time: "01:30" } });
    expect(
      occurrences(
        repeated,
        Date.parse("2026-11-01T07:00:00Z"),
        Date.parse("2026-11-01T12:00:00Z"),
      ).map((at) => new Date(at).toISOString()),
    ).toEqual(["2026-11-01T08:30:00.000Z"]);
  });

  it("handles weekly days, short months, and one-time items", () => {
    const now = Date.parse("2026-09-30T12:00:00Z"); // Wednesday
    expect(new Date(nextOccurrence(item(), now)!).toISOString()).toBe(
      "2026-10-05T16:00:00.000Z",
    );
    const monthly = item({
      schedule: { kind: "monthly", day: 31, time: "08:00" },
      time_zone: "UTC",
    });
    expect(
      occurrences(
        monthly,
        Date.parse("2027-01-31T09:00:00Z"),
        Date.parse("2027-04-01T00:00:00Z"),
      ).map((at) => new Date(at).toISOString().slice(0, 10)),
    ).toEqual(["2027-02-28", "2027-03-31"]);
    const once = item({
      schedule: { kind: "once", at: "2026-10-02T10:00:00-07:00" },
    });
    expect(nextOccurrence(once, now)).toBe(Date.parse("2026-10-02T17:00:00Z"));
    expect(nextOccurrence(once, Date.parse("2026-10-03T00:00:00Z"))).toBe(
      undefined,
    );
    expect(nextOccurrence({ ...once, status: "paused" }, now)).toBe(undefined);
  });

  it("makes only the latest missed occurrence due, within a window", () => {
    const daily = item({ schedule: { kind: "daily", time: "09:00" } });
    const now = Date.parse("2026-10-05T20:00:00Z");
    expect(dueOccurrence(daily, 0, now)).toBe(
      Date.parse("2026-10-05T16:00:00Z"),
    );
    // Already delivered.
    expect(dueOccurrence(daily, Date.parse("2026-10-05T16:00:00Z"), now)).toBe(
      undefined,
    );
    // An item created after the occurrence is not due yet.
    expect(
      dueOccurrence({ ...daily, created_at: "2026-10-05T17:00:00Z" }, 0, now),
    ).toBe(undefined);
    // A one-time item missed long ago is not replayed.
    const old = item({
      schedule: { kind: "once", at: "2026-09-01T09:00:00Z" },
    });
    expect(dueOccurrence(old, 0, now)).toBe(undefined);
  });

  it("reads the ISO 8601 forms agents write, the same way everywhere", () => {
    const at = Date.parse("2026-10-01T01:00:00Z");
    for (const value of [
      "2026-10-01T09:00:00+08:00",
      "2026-10-01T09:00+08:00",
      "2026-10-01T09:00:00+0800",
      "2026-10-01T09:00:00.000000+08:00",
      "2026-10-01T01:00:00Z",
    ])
      expect(isoTime(value)).toBe(at);
    for (const value of ["2026-10-01", "2026-10-01 09:00:00+08:00", "tomorrow"])
      expect(isoTime(value)).toBeNaN();
    expect(
      parseUpcoming(
        serializeUpcoming([
          item({
            schedule: { kind: "once", at: "2026-10-02T10:00+08:00" },
            created_at: "2026-09-30T08:00:00+0800",
          }),
        ]),
      ),
    ).toHaveLength(1);
  });

  it("does not replay an occurrence that passed while an item was paused", () => {
    const daily = item({ schedule: { kind: "daily", time: "09:00" } });
    const now = Date.parse("2026-10-05T22:00:00Z");
    expect(dueOccurrence(daily, 0, now)).toBe(
      Date.parse("2026-10-05T16:00:00Z"),
    );
    expect(
      dueOccurrence({ ...daily, updated_at: "2026-10-05T21:00:00Z" }, 0, now),
    ).toBe(undefined);
  });

  it("validates the stored document without discarding data", () => {
    expect(parseUpcoming(emptyUpcomingDocument)).toEqual([]);
    expect(parseUpcoming(serializeUpcoming([item()]))).toEqual([item()]);
    for (const bad of [
      "{",
      JSON.stringify({ version: 1, items: [item(), item()] }),
      JSON.stringify({ version: 1, items: [item({ time_zone: "Mars/Base" })] }),
      JSON.stringify({
        version: 1,
        items: [
          {
            ...item(),
            schedule: { kind: "weekly", days: [1, 1], time: "09:00" },
          },
        ],
      }),
      JSON.stringify({
        version: 1,
        items: [{ ...item(), schedule: { kind: "daily", time: "9am" } }],
      }),
    ])
      expect(() => parseUpcoming(bad)).toThrow("Nothing was replaced");
  });

  it("describes schedules in English and Simplified Chinese", () => {
    expect(describeSchedule(item(), "en-US")).toBe("Every Mon at 9:00 AM");
    expect(
      describeSchedule(
        item({ schedule: { kind: "weekly", days: [5, 1], time: "18:30" } }),
        "en-US",
      ),
    ).toBe("Every Mon, Fri at 6:30 PM");
    expect(
      describeSchedule(
        item({ schedule: { kind: "daily", time: "07:05" } }),
        "en-US",
      ),
    ).toBe("Every day at 7:05 AM");
    expect(
      t("Every {days} at {time}", { days: "周一", time: "09:00" }, "zh-CN"),
    ).toBe("每周一 09:00");
    expect(t("Upcoming", {}, "zh-CN")).toBe("即将到来");
    expect(t("Upcoming tab", {}, "zh-CN")).toBe("近期");
  });

  it("tells the agent how to keep and honestly describe upcoming items", () => {
    expect(identityInstructions).toContain(upcomingInstructions);
    expect(upcomingInstructions).toContain("read the document back");
    expect(upcomingInstructions).toContain("schedules a notification");
    expect(upcomingInstructions).toContain("within a week of the last time");
    expect(upcomingInstructions).toContain("Do not ask them to keep the app");
    const prompt = reminderPrompt("zh-CN", new Date(0), [
      { item: item(), at: 0 },
    ]);
    expect(prompt).toContain("<open-muse-reminder>");
    expect(prompt).toContain("not a new request");
    expect(prompt).toContain('"Submit timesheet"');
    expect(prompt).toContain("set its status to done");
    expect(prompt).toContain("locale zh-CN");
  });
});

function fixture(items: UpcomingItem[], now: number) {
  const db = new LocalDatabase(`upcoming-${uuid()}`);
  const doc = { content: serializeUpcoming(items) };
  const identity = {
    upcomingDocument: vi.fn(async () => ({
      content: doc.content,
      revision: digest(doc.content),
      id: "mem",
    })),
    saveUpcomingDocument: vi.fn(async (content: string, revision: string) => {
      if (revision !== digest(doc.content)) throw new ApiError(409, "changed");
      doc.content = content;
      return { content, revision: digest(content), id: "mem" };
    }),
  };
  const events: AgentEvent[] = [
    { id: "a", type: "agent.message", content: [{ type: "text", text: "hi" }] },
  ];
  const session: Session = {
    id: "main",
    title: "Main chat",
    category: "general",
    status: "idle",
    created_at: "",
    updated_at: "",
  };
  const clock = { now };
  const remote = {
    main: vi.fn(async (): Promise<Session | undefined> => session),
    mainId: vi.fn(async (): Promise<string | undefined> => session.id),
    server: vi.fn(async (): Promise<UpcomingDelivery | undefined> => undefined),
    register: vi.fn(async (_session: string) => undefined),
    history: vi.fn(async () => events),
    send: vi.fn(async (_s: string, text: string, id: string) => {
      const event: AgentEvent = {
        id,
        type: "user.message",
        content: [{ type: "text", text }],
      };
      events.push(event);
      return { data: [event] };
    }),
  };
  const service = new DirectUpcoming(
    "owner",
    db,
    identity,
    remote,
    () => clock.now,
  );
  return { db, doc, identity, events, session, remote, clock, service };
}

describe("Upcoming delivery", () => {
  const daily = item({
    id: "standup",
    schedule: { kind: "daily", time: "09:00" },
  });
  const before = Date.parse("2026-10-05T15:00:00Z"); // 08:00 PDT

  it("starts after this device's first run and delivers each occurrence once", async () => {
    const f = fixture([daily], before);
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.history).not.toHaveBeenCalled();
    f.clock.now += 2 * hour;
    const record = await f.service.start("en");
    expect(record?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    const initiation = f.events.at(-1)!;
    expect((await f.service.annotate("main", initiation)).app_initiation).toBe(
      "reminder",
    );
    f.events.push({
      id: "r",
      type: "agent.message",
      content: [{ type: "text", text: "Time to submit." }],
    });
    f.clock.now += hour;
    expect(await f.service.start("en")).toBeUndefined();
    f.clock.now += 22 * hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(2);
  });

  it("does not replay occurrences from before a new device's first run", async () => {
    const f = fixture([daily], Date.parse("2026-10-05T20:00:00Z"));
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
  });

  it("skips paused items and waits for a busy conversation", async () => {
    const f = fixture([{ ...daily, status: "paused" }], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    expect(await f.service.start("en")).toBeUndefined();
    const g = fixture([daily], before);
    await g.service.start("en");
    g.clock.now += 2 * hour;
    g.session.status = "running";
    expect(await g.service.start("en")).toBeUndefined();
    g.session.status = "idle";
    expect((await g.service.start("en"))?.phase).toBe("confirmed");
  });

  it("never resends an ambiguous or rejected delivery", async () => {
    const f = fixture([daily], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    f.remote.send.mockRejectedValueOnce(new Error("network"));
    await expect(f.service.start("en")).rejects.toThrow("network");
    f.clock.now += 60000;
    expect(await f.service.start("en")).toBeUndefined();
    const g = fixture([daily], before);
    await g.service.start("en");
    g.clock.now += 2 * hour;
    g.remote.send.mockRejectedValueOnce(new ApiError(429, "busy"));
    await expect(g.service.start("en")).rejects.toThrow("busy");
    expect(await g.service.start("en")).toBeUndefined();
    expect(g.remote.send).toHaveBeenCalledTimes(1);
  });

  it("skips an occurrence another device already delivered", async () => {
    const f = fixture([daily], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    const due = Date.parse("2026-10-05T16:00:00Z");
    f.events.push({
      id: "elsewhere",
      type: "user.message",
      content: [
        {
          type: "text",
          text: reminderPrompt("en", new Date(due), [{ item: daily, at: due }]),
        },
      ],
    });
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    // Recorded locally, so the next minute does not read history again.
    const reads = f.remote.history.mock.calls.length;
    f.clock.now += 60000;
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.history.mock.calls.length).toBe(reads);
    expect(
      deliveredOccurrences([
        {
          id: "typed",
          type: "user.message",
          content: [
            {
              type: "text",
              text: "- id standup, daily, due 2026-10-05T16:00:00.000Z: x",
            },
          ],
        },
      ]).size,
    ).toBe(0);
  });

  it("waits while the conversation is blocked on a tool result", async () => {
    const f = fixture([daily], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    f.events.push(
      { id: "tool", type: "agent.custom_tool_use", name: "health_read" },
      {
        id: "idle",
        type: "session.status_idle",
        stop_reason: { type: "requires_action", event_ids: ["tool"] },
      },
    );
    expect(await f.service.start("en")).toBeUndefined();
    f.events.push({
      id: "result",
      type: "user.custom_tool_result",
      custom_tool_use_id: "tool",
    });
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
  });

  it("delivers a large batch in bounded messages, recognized on any device", async () => {
    const many = Array.from({ length: reminderBatch + 2 }, (_, index) =>
      item({
        id: `item-${index}`,
        instruction: "x".repeat(2000),
        schedule: { kind: "daily", time: "09:00" },
      }),
    );
    const f = fixture(many, before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    await f.service.start("en");
    const first = f.remote.send.mock.calls[0][1];
    expect(first.length).toBeLessThan(16000);
    expect(deliveredOccurrences([f.events.at(-1)!]).size).toBe(reminderBatch);
    expect(isReminderPrompt(first)).toBe(true);
    expect(
      (
        await new DirectUpcoming(
          "other-device",
          f.db,
          f.identity,
          f.remote,
        ).annotate("main", f.events.at(-1)!)
      ).app_initiation,
    ).toBe("reminder");
    f.events.push({
      id: "reply",
      type: "agent.message",
      content: [{ type: "text", text: "Done." }],
    });
    f.clock.now += 60000;
    await f.service.start("en");
    expect(f.remote.send).toHaveBeenCalledTimes(2);
    expect(deliveredOccurrences([f.events.at(-1)!]).size).toBe(2);
  });

  it("leaves delivery to the service and keeps it on the main chat", async () => {
    const f = fixture([daily], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    const server: UpcomingDelivery = {
      enabled: true,
      session_id: "main",
      language: "en",
      since: before,
      revision: 1,
      state: "active",
    };
    f.remote.server.mockResolvedValue(server);
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    expect(f.remote.register).not.toHaveBeenCalled();
    // The main chat continued into a new chapter: register it, still no send.
    f.remote.mainId.mockResolvedValue("main-2");
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.register).toHaveBeenCalledWith("main-2");
    // An unavailable session is registered again too.
    f.remote.mainId.mockResolvedValue("main");
    f.remote.server.mockResolvedValue({
      ...server,
      state: "session_unavailable",
    });
    await f.service.start("en");
    expect(f.remote.register).toHaveBeenLastCalledWith("main");
    // Turned off on the service, or unreachable: this device delivers again.
    f.remote.server.mockRejectedValue(new Error("offline"));
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
  });

  it("shares one delivery between concurrent runs and views", async () => {
    const f = fixture([daily], before);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    const other = new DirectUpcoming(
      "owner",
      f.db,
      f.identity,
      f.remote,
      () => f.clock.now,
    );
    await Promise.all([f.service.start("en"), other.start("en")]);
    expect(f.remote.send).toHaveBeenCalledTimes(1);
  });

  it("pauses, resumes, and deletes with revision checks", async () => {
    const f = fixture([daily, item()], before);
    const first = await f.service.list();
    const paused = await f.service.change(daily.id, "pause", first.revision);
    expect(paused.items[0].status).toBe("paused");
    await expect(
      f.service.change(daily.id, "resume", first.revision),
    ).rejects.toThrow("Upcoming items changed");
    const resumed = await f.service.change(daily.id, "resume", paused.revision);
    expect(resumed.items[0].status).toBe("active");
    const deleted = await f.service.change(
      "timesheet",
      "delete",
      resumed.revision,
    );
    expect(deleted.items.map((entry) => entry.id)).toEqual(["standup"]);
    await expect(
      f.service.change("timesheet", "delete", deleted.revision),
    ).rejects.toThrow("no longer exists");
  });
});
