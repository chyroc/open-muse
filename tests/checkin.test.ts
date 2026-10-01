import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/ark";
import { uuid } from "../shared/crypto";
import { t } from "../shared/i18n";
import { checkInDue, checkInPolicy, checkInPrompt } from "../shared/checkin";
import type { AgentEvent, Session } from "../shared/types";
import { DirectCheckIn } from "../src/direct/checkin";
import { LocalDatabase } from "../src/direct/storage";

const hour = 60 * 60 * 1000;
// A Tuesday, 10:00 local time.
const morning = new Date(2026, 8, 29, 10).getTime();
const at = (ms: number) => new Date(ms).toISOString();
const message = (
  id: string,
  type: "user.message" | "agent.message",
  time: number,
  text = id,
): AgentEvent => ({
  id,
  type,
  created_at: at(time),
  content: [{ type: "text", text }],
});

function fixture(now = morning) {
  const db = new LocalDatabase(`checkin-${uuid()}`);
  const events: AgentEvent[] = [
    message("hello", "user.message", now - 30 * hour),
    message("answer", "agent.message", now - 29 * hour),
  ];
  const session: Session = {
    id: "main-one",
    title: "Main chat",
    category: "general",
    status: "idle",
    created_at: "",
    updated_at: "",
  };
  const clock = { now };
  const remote = {
    main: vi.fn(async (): Promise<Session | undefined> => session),
    history: vi.fn(async () => events),
    send: vi.fn(async (_session: string, text: string, id: string) => {
      const event: AgentEvent = {
        id,
        type: "user.message",
        created_at: at(clock.now),
        content: [{ type: "text", text }],
      };
      events.push(event);
      return { data: [event] };
    }),
  };
  const service = new DirectCheckIn("owner", db, remote, () => clock.now);
  return { db, events, session, remote, clock, service };
}

describe("Check-in policy", () => {
  const history = [
    message("hello", "user.message", morning - 30 * hour),
    message("answer", "agent.message", morning - 29 * hour),
  ];
  const base = {
    enabled: true,
    now: morning,
    status: "idle",
    history,
    records: [],
  };

  it("checks in only on an established, quiet, idle conversation in daytime", () => {
    expect(checkInDue(base)).toBe(true);
    expect(checkInDue({ ...base, enabled: false })).toBe(false);
    expect(checkInDue({ ...base, status: "running" })).toBe(false);
    expect(checkInDue({ ...base, history: [] })).toBe(false);
    expect(checkInDue({ ...base, history: history.slice(1) })).toBe(false);
    // The person spoke last: their message is still awaiting a reply.
    expect(
      checkInDue({
        ...base,
        history: [
          ...history,
          message("q", "user.message", morning - 20 * hour),
        ],
      }),
    ).toBe(false);
    expect(
      checkInDue({
        ...base,
        history: [
          history[0],
          message("answer", "agent.message", morning - hour),
        ],
      }),
    ).toBe(false);
    const night = new Date(2026, 8, 29, 23).getTime();
    expect(checkInDue({ ...base, now: night })).toBe(false);
    const early = new Date(2026, 8, 29, checkInPolicy.from - 1).getTime();
    expect(checkInDue({ ...base, now: early })).toBe(false);
  });

  it("never stacks check-ins or repeats one within a day", () => {
    const record = {
      phase: "confirmed" as const,
      session: "main-one",
      eventId: "evt-1",
      text: "prompt",
      at: morning - 21 * hour,
      replyId: "answer",
    };
    // The last message is the reply to an unanswered check-in.
    const unanswered = [
      ...history,
      message("evt-1", "user.message", morning - 21 * hour, "prompt"),
      message("reply", "agent.message", morning - 20.9 * hour),
    ];
    expect(
      checkInDue({ ...base, history: unanswered, records: [record] }),
    ).toBe(false);
    // The same holds for a welcome or reminder prompt from any device.
    for (const tag of ["welcome", "reminder"])
      expect(
        checkInDue({
          ...base,
          history: [
            ...history,
            message(
              "app",
              "user.message",
              morning - 21 * hour,
              `<open-muse-${tag}>x`,
            ),
            message("reply", "agent.message", morning - 20.9 * hour),
          ],
        }),
      ).toBe(false);
    // Once the person answers the welcome, the conversation counts.
    expect(
      checkInDue({
        ...base,
        history: [
          message(
            "w",
            "user.message",
            morning - 30 * hour,
            "<open-muse-welcome>x",
          ),
          message("name", "agent.message", morning - 29 * hour),
          message("kit", "user.message", morning - 28 * hour, "Kit"),
          message("ok", "agent.message", morning - 27 * hour),
        ],
      }),
    ).toBe(true);
    // A session waiting on a tool result is waiting on the person.
    expect(
      checkInDue({
        ...base,
        history: [
          ...history,
          { id: "tool", type: "agent.custom_tool_use", name: "health_read" },
          {
            id: "idle",
            type: "session.status_idle",
            stop_reason: { type: "requires_action", event_ids: ["tool"] },
          },
        ],
      }),
    ).toBe(false);
    const answered = { ...record, replyId: "older" };
    expect(checkInDue({ ...base, records: [answered] })).toBe(true);
    expect(
      checkInDue({ ...base, records: [{ ...answered, at: morning - hour }] }),
    ).toBe(false);
    expect(
      checkInDue({
        ...base,
        records: [{ ...answered, phase: "sending" }],
      }),
    ).toBe(false);
    // A definitive rejection does not hold back the next quiet period.
    expect(
      checkInDue({
        ...base,
        records: [{ ...answered, phase: "rejected", at: morning - hour }],
      }),
    ).toBe(true);
  });

  it("asks for one grounded question without leaking the initiation", () => {
    const prompt = checkInPrompt("zh-CN", new Date(morning));
    expect(prompt).toContain("<open-muse-checkin>");
    expect(prompt).toContain("locale zh-CN");
    expect(prompt).toContain("Tuesday");
    expect(prompt).toContain("not written by the person");
    expect(prompt).toContain("Do not mention this initiation");
    expect(prompt).toContain("claim reminders");
    expect(checkInPrompt("en; drop", new Date(morning))).toContain(
      "locale en,",
    );
  });
});

describe("Check-in initiation", () => {
  it("sends once, hides the initiation and waits for an answer", async () => {
    const f = fixture();
    const record = await f.service.start("en");
    expect(record?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    const initiation = f.events.at(-1)!;
    expect(
      (await f.service.annotate(f.session.id, initiation)).app_initiation,
    ).toBe("checkin");
    // The prompt is recognized wherever it appears, such as another device.
    expect((await f.service.annotate("other", initiation)).app_initiation).toBe(
      "checkin",
    );
    expect(
      (await f.service.annotate(f.session.id, f.events[0])).app_initiation,
    ).toBeUndefined();
    // Reopening the app the same day sends nothing new.
    f.clock.now += hour;
    expect(await f.service.start("en")).toBeUndefined();
    // Even a day later, an unanswered check-in is not followed by another.
    f.events.push(message("reply", "agent.message", f.clock.now));
    f.clock.now += 24 * hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect((await f.service.state()).records[0].replyId).toBe("reply");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    // After the person answers and things go quiet again, one more is allowed.
    f.events.push(message("mine", "user.message", f.clock.now));
    f.events.push(message("thanks", "agent.message", f.clock.now));
    f.clock.now += 24 * hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(2);
    const { records } = await f.service.state();
    expect(records).toHaveLength(2);
    // Both initiations stay hidden.
    for (const record of records)
      expect(
        (
          await f.service.annotate(
            f.session.id,
            f.events.find((event) => event.id === record.eventId)!,
          )
        ).app_initiation,
      ).toBe("checkin");
  });

  it("does nothing when disabled, without a main chat, or for other text", async () => {
    const f = fixture();
    await f.service.setEnabled(false);
    expect(await f.service.start("en")).toBeUndefined();
    await f.service.setEnabled(true);
    f.remote.main.mockResolvedValueOnce(undefined);
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).not.toHaveBeenCalled();
    await f.service.start("en");
    const initiation = f.events.at(-1)!;
    const typed = {
      ...initiation,
      id: "typed",
      content: [{ type: "text", text: "<open-muse-checkin> hello" }],
    };
    expect(
      (await f.service.annotate(f.session.id, typed)).app_initiation,
    ).toBeUndefined();
    expect(
      (
        await f.service.annotate(f.session.id, {
          ...initiation,
          content: [{ type: "text", text: "edited" }],
        })
      ).app_initiation,
    ).toBeUndefined();
  });

  it("shares one request between concurrent starts and views", async () => {
    const f = fixture();
    const other = new DirectCheckIn("owner", f.db, f.remote, () => f.clock.now);
    await Promise.all([
      f.service.start("en"),
      f.service.start("en"),
      other.start("en"),
    ]);
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    expect(
      (await new DirectCheckIn("another", f.db, f.remote).state()).records,
    ).toEqual([]);
  });

  it("reconciles an ambiguous send from history instead of sending again", async () => {
    const f = fixture();
    f.remote.send.mockImplementationOnce(async (_s, text, id) => {
      f.events.push({
        id,
        type: "user.message",
        created_at: at(f.clock.now),
        content: [{ type: "text", text }],
      });
      throw new Error("network");
    });
    await expect(f.service.start("en")).rejects.toThrow("network");
    expect((await f.service.state()).records[0].phase).toBe("unconfirmed");
    f.clock.now += hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect((await f.service.state()).records[0].phase).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledTimes(1);
  });

  it("keeps an unconfirmed send blocking and never retries it the same day", async () => {
    const f = fixture();
    f.remote.send.mockRejectedValueOnce(new Error("network"));
    await expect(f.service.start("en")).rejects.toThrow("network");
    f.clock.now += 2 * hour;
    expect(await f.service.start("en")).toBeUndefined();
    expect(f.remote.send).toHaveBeenCalledTimes(1);
    // A later quiet day starts a new check-in with a new event ID.
    f.clock.now += 24 * hour;
    expect((await f.service.start("en"))?.phase).toBe("confirmed");
    const ids = (await f.service.state()).records.map((r) => r.eventId);
    expect(new Set(ids).size).toBe(2);
  });

  it("records a definitive rejection and reports an unconfirmed result", async () => {
    const f = fixture();
    f.remote.send.mockRejectedValueOnce(new ApiError(429, "busy"));
    await expect(f.service.start("en")).rejects.toThrow("busy");
    expect((await f.service.state()).records[0].phase).toBe("rejected");
    f.remote.send.mockResolvedValueOnce({ data: [] });
    await expect(f.service.start("en")).rejects.toThrow(
      "The check-in is unconfirmed",
    );
    expect((await f.service.state()).records[1].phase).toBe("unconfirmed");
  });

  it("translates its settings and errors", () => {
    expect(t("Check-ins", {}, "zh-CN")).toBe("主动问候");
    expect(
      t(
        "The check-in is unconfirmed. Refresh history; it will not be sent again.",
        {},
        "zh-CN",
      ),
    ).toContain("不会被再次发送");
  });
});
