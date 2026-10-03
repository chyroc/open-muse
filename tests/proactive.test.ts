import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { t } from "../shared/i18n";
import { checkInDue, checkInPrompt, isCheckInPrompt } from "../shared/checkin";
import {
  goalFollowUpPrompt,
  isGoalFollowUpPrompt,
  staleGoal,
} from "../shared/goal-followup";
import {
  claimInput,
  localDay,
  localHour,
  validTimeZone,
} from "../shared/proactive";
import {
  isReminderPrompt,
  serializeUpcoming,
  type UpcomingItem,
} from "../shared/upcoming";
import type { AgentEvent, Goal, Session } from "../shared/types";
import { DirectCheckIn } from "../src/direct/checkin";
import { DirectUpcoming } from "../src/direct/upcoming";
import { LocalDatabase } from "../src/direct/storage";

const hour = 3_600_000;
const day = 24 * hour;
const text = (event: AgentEvent) =>
  (event.content as { text: string }[])[0].text;
const main: Session = {
  id: "main",
  title: "Main chat",
  category: "general",
  status: "idle",
  created_at: "",
  updated_at: "",
};
const sender = (events: AgentEvent[]) =>
  vi.fn(async (_s: string, body: string, id: string) => {
    const event: AgentEvent = {
      id,
      type: "user.message",
      content: [{ type: "text", text: body }],
    };
    events.push(event);
    return { data: [event] };
  });

describe("Proactive time and keys", () => {
  it("reads local dates and hours in a given time zone", () => {
    const at = Date.parse("2026-10-05T03:00:00Z");
    expect(localDay(at, "UTC")).toBe("2026-10-05");
    expect(localDay(at, "America/New_York")).toBe("2026-10-04");
    expect(localHour(at, "America/New_York")).toBe(23);
    expect(localHour(at, "Asia/Shanghai")).toBe(11);
    expect(validTimeZone("Europe/Berlin")).toBe(true);
    expect(validTimeZone("Not/AZone")).toBe(false);
    expect(validTimeZone("")).toBe(false);
  });

  it("validates claims", () => {
    const ok = {
      kind: "reminder",
      key: "standup@1767000000000",
      session_id: "s",
    };
    expect(claimInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, kind: "welcome" },
      { ...ok, key: "Submit my timesheet" },
      { ...ok, session_id: "a/b" },
      { ...ok, extra: true },
    ])
      expect(claimInput.safeParse(bad).success).toBe(false);
  });

  it("applies check-in hours in the person's time zone on the service", () => {
    const history: AgentEvent[] = [
      {
        id: "u",
        type: "user.message",
        created_at: "2026-10-04T00:00:00Z",
        content: [{ type: "text", text: "hi" }],
      },
      {
        id: "a",
        type: "agent.message",
        created_at: "2026-10-04T01:00:00Z",
        content: [{ type: "text", text: "hello" }],
      },
    ];
    // 14:00 UTC is 10:00 in New York and 23:00 in Tokyo.
    const now = Date.parse("2026-10-05T14:00:00Z");
    const base = { enabled: true, now, status: "idle", history, records: [] };
    expect(checkInDue({ ...base, timeZone: "America/New_York" })).toBe(true);
    expect(checkInDue({ ...base, timeZone: "Asia/Tokyo" })).toBe(false);
    // An unanswered goal follow-up counts as the app's own question.
    const followUp: AgentEvent = {
      id: "g",
      type: "user.message",
      created_at: "2026-10-04T02:00:00Z",
      content: [
        {
          type: "text",
          text: goalFollowUpPrompt("en", new Date(now), goal("run", 0)),
        },
      ],
    };
    expect(
      checkInDue({
        ...base,
        timeZone: "America/New_York",
        history: [
          ...history,
          followUp,
          { ...history[1], id: "b", created_at: "2026-10-04T03:00:00Z" },
        ],
      }),
    ).toBe(false);
    // The service's prompt is the app's prompt, with the person's local time.
    const prompt = checkInPrompt("en", new Date(now), "America/New_York");
    expect(isCheckInPrompt(prompt)).toBe(true);
    expect(prompt).toContain("Monday 10:00 AM");
  });
});

const goal = (id: string, updated: number, patch: Partial<Goal> = {}): Goal =>
  ({
    id,
    title: `Goal ${id}`,
    description: "",
    status: "active",
    steps: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: new Date(updated).toISOString(),
    ...patch,
  }) as Goal;

describe("Goal follow-ups", () => {
  it("picks the stalest active goal without a week of progress", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const goals = [
      goal("fresh", now - 6 * day),
      goal("paused", now - 30 * day, { status: "paused" }),
      goal("done", now - 30 * day, { status: "completed" }),
      goal("read", now - 8 * day),
      goal("run", now - 9 * day),
    ];
    expect(staleGoal(goals, now, new Set())?.id).toBe("run");
    expect(staleGoal(goals, now, new Set(["run"]))?.id).toBe("read");
    expect(staleGoal(goals, now, new Set(["run", "read"]))).toBeUndefined();
  });

  it("is an app message every app hides like a check-in", async () => {
    const prompt = goalFollowUpPrompt(
      "zh-CN",
      new Date("2026-10-20T12:00:00Z"),
      goal("run", Date.parse("2026-10-10T00:00:00Z"), {
        title: 'Run a "5k"',
      }),
      "Asia/Shanghai",
    );
    expect(isGoalFollowUpPrompt(prompt)).toBe(true);
    expect(isCheckInPrompt(prompt)).toBe(false);
    expect(prompt).toContain('"Run a \\"5k\\""');
    expect(prompt).toContain("locale zh-CN");
    expect(prompt).toContain("8:00 PM");
    expect(prompt).toContain("Do not mention this initiation");
    const service = new DirectCheckIn(
      "owner",
      new LocalDatabase(`goal-${uuid()}`),
      {
        main: async () => main,
        history: async () => [],
        send: sender([]),
      },
    );
    const event: AgentEvent = {
      id: "evt-goal",
      type: "user.message",
      content: [{ type: "text", text: prompt }],
    };
    expect((await service.annotate("main", event)).app_initiation).toBe(
      "checkin",
    );
  });
});

function checkInFixture(claim?: ReturnType<typeof vi.fn>) {
  // A Tuesday, 10:00 local time.
  const now = new Date(2026, 8, 29, 10).getTime();
  const events: AgentEvent[] = [
    {
      id: "hello",
      type: "user.message",
      created_at: new Date(now - 30 * hour).toISOString(),
      content: [{ type: "text", text: "hello" }],
    },
    {
      id: "answer",
      type: "agent.message",
      created_at: new Date(now - 29 * hour).toISOString(),
      content: [{ type: "text", text: "answer" }],
    },
  ];
  const remote = {
    main: vi.fn(async (): Promise<Session | undefined> => main),
    history: vi.fn(async () => events),
    send: sender(events),
    ...(claim ? { claim } : {}),
  };
  const clock = { now };
  const service = new DirectCheckIn(
    "owner",
    new LocalDatabase(`checkin-claim-${uuid()}`),
    remote as ConstructorParameters<typeof DirectCheckIn>[2],
    () => clock.now,
  );
  return { now, clock, events, remote, service };
}

describe("Claiming a check-in with an account", () => {
  it("claims the local day with the service before sending", async () => {
    const claim = vi.fn(async () => true);
    const f = checkInFixture(claim);
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(claim).toHaveBeenCalledWith("checkin", localDay(f.now), "main");
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(
      f.remote.send.mock.invocationCallOrder[0],
    );
  });

  it("sends nothing when another device or the service holds the day", async () => {
    const claim = vi.fn(async () => false);
    const f = checkInFixture(claim);
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    expect((await f.service.state()).records).toEqual([]);
    // The same day is not asked about again.
    f.clock.now += hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the service cannot be reached, and tries later", async () => {
    const claim = vi.fn(async (): Promise<boolean> => {
      throw new Error("offline");
    });
    const f = checkInFixture(claim);
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    expect((await f.service.state()).records).toEqual([]);
    claim.mockResolvedValue(true);
    f.clock.now += hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
  });

  it("keeps local mode unchanged", async () => {
    const f = checkInFixture();
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
  });
});

const daily = (id: string): UpcomingItem => ({
  id,
  title: `Reminder ${id}`,
  instruction: "",
  schedule: { kind: "daily", time: "09:00" },
  time_zone: "UTC",
  status: "active",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

function upcomingFixture(
  items: UpcomingItem[],
  claim?: ReturnType<typeof vi.fn>,
) {
  const content = serializeUpcoming(items);
  const events: AgentEvent[] = [
    { id: "a", type: "agent.message", content: [{ type: "text", text: "hi" }] },
  ];
  const remote = {
    main: vi.fn(async (): Promise<Session | undefined> => main),
    mainId: vi.fn(async () => "main"),
    history: vi.fn(async () => events),
    send: sender(events),
    ...(claim ? { claim } : {}),
  };
  const clock = { now: Date.parse("2026-10-05T08:00:00Z") };
  const service = new DirectUpcoming(
    "owner",
    new LocalDatabase(`upcoming-claim-${uuid()}`),
    {
      upcomingDocument: async () => ({ content, revision: digest(content) }),
      saveUpcomingDocument: async () => {
        throw new ApiError(409, "unused");
      },
    },
    remote as ConstructorParameters<typeof DirectUpcoming>[3],
    () => clock.now,
  );
  return { clock, events, remote, service };
}
const due = Date.parse("2026-10-05T09:00:00Z");

describe("Claiming reminders with an account", () => {
  it("claims each occurrence and delivers only the ones it won", async () => {
    const claim = vi.fn(async (_kind: string, key: string) =>
      key.startsWith("a@"),
    );
    const f = upcomingFixture([daily("a"), daily("b")], claim);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(claim).toHaveBeenCalledWith("reminder", `a@${due}`, "main");
    expect(claim).toHaveBeenCalledWith("reminder", `b@${due}`, "main");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    const sent = text(f.events.at(-1)!);
    expect(isReminderPrompt(sent)).toBe(true);
    expect(sent).toContain(`id a, daily, due ${new Date(due).toISOString()}`);
    expect(sent).not.toContain("id b,");
    // The lost occurrence is not claimed again.
    f.clock.now += hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when every claim is lost", async () => {
    const claim = vi.fn(async () => false);
    const f = upcomingFixture([daily("a")], claim);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    expect((await f.service.state()).records).toEqual([]);
  });

  it("keeps an occurrence due when the service cannot be reached", async () => {
    const claim = vi.fn(async (): Promise<boolean> => {
      throw new Error("offline");
    });
    const f = upcomingFixture([daily("a")], claim);
    await f.service.start("en");
    f.clock.now += 2 * hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    expect((await f.service.state()).delivered).toEqual({});
    claim.mockResolvedValue(true);
    f.clock.now += hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
  });
});

describe("Proactive settings copy", () => {
  it("translates the closed-app switches", () => {
    expect(t("Check in even when Open Muse is closed", {}, "zh-CN")).toBe(
      "即使 Open Muse 已关闭也主动问候",
    );
    expect(t("Follow up on goals", {}, "zh-CN")).toBe("跟进目标");
    expect(
      t(
        "When an active goal has had no progress for a week, the service may ask about it in your main chat, at most once every three days and in place of that day's check-in. Each follow-up is a real Ark request and may be billed.",
        {},
        "zh-CN",
      ),
    ).toContain("可能产生费用");
    expect(
      t(
        "The Open Muse service may start the day's check-in in your main chat while every app is closed, with the same quiet hours and limits, in your time zone. Each one is a real Ark request with your saved key and may be billed.",
        {},
        "zh-CN",
      ),
    ).toContain("可能产生费用");
  });
});
