import { z } from "zod";
import { t } from "./i18n";
import { eventText, type AgentEvent } from "./types";

// Reminders and recurring tasks the person set up in chat. MA memory
// (UPCOMING.md) is the source of truth; the app computes occurrences and
// delivers due items into the main chat while it is open.
const day = 86400000;
// ISO 8601 with an offset; seconds are optional and "+0800" means "+08:00".
// Normalized before parsing so every JavaScript engine reads it the same way.
const isoPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/;
export function isoTime(value: string) {
  const match = isoPattern.exec(value);
  if (!match) return NaN;
  const [, minute, seconds = "00", fraction = "", zone] = match;
  const offset = zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  return Date.parse(
    `${minute}:${seconds}.${fraction.padEnd(3, "0").slice(0, 3)}${offset}`,
  );
}
export const isoInput = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(isoTime(value)));
const id = z.string().regex(/^[\w-]{1,80}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timeZone = z
  .string()
  .max(80)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  });
export const scheduleInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("once"),
      at: isoInput,
    })
    .strict(),
  z.object({ kind: z.literal("daily"), time }).strict(),
  z
    .object({
      kind: z.literal("weekly"),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      time,
    })
    .strict(),
  z
    .object({
      kind: z.literal("monthly"),
      day: z.number().int().min(1).max(31),
      time,
    })
    .strict(),
  // Birthdays and anniversaries; a day the month lacks falls on its last day.
  z
    .object({
      kind: z.literal("yearly"),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      time,
    })
    .strict(),
]);
export const upcomingInput = z
  .object({
    id,
    title: z.string().trim().min(1).max(160),
    instruction: z.string().max(2000),
    schedule: scheduleInput,
    time_zone: timeZone,
    status: z.enum(["active", "paused", "done"]),
    created_at: isoInput,
    updated_at: isoInput,
  })
  .strict();
export type UpcomingItem = z.infer<typeof upcomingInput>;
// The service's reminder delivery for an account, as GET/PUT
// /v1/account/upcoming return it.
export const upcomingDeliveryInput = z.object({
  enabled: z.boolean(),
  session_id: z.string().nullable(),
  language: z.enum(["en", "zh-CN"]).nullable(),
  since: z.number().nullable(),
  revision: z.number().int().nonnegative(),
  state: z.enum(["active", "session_unavailable"]).nullable(),
  // Check-ins and goal follow-ups while the apps are closed; both off by
  // default. Older services omit them.
  checkins: z.boolean().optional(),
  goal_followups: z.boolean().optional(),
  time_zone: z.string().nullable().optional(),
});
export type UpcomingDelivery = z.infer<typeof upcomingDeliveryInput>;
export type Schedule = z.infer<typeof scheduleInput>;
const documentInput = z
  .object({ version: z.literal(1), items: z.array(upcomingInput).max(100) })
  .strict();
export const emptyUpcomingDocument = JSON.stringify(
  { version: 1, items: [] },
  null,
  2,
);

export function parseUpcoming(content: string): UpcomingItem[] {
  try {
    if (content.length > 64000) throw new Error("Too large");
    const { items } = documentInput.parse(JSON.parse(content));
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error("Duplicate items");
    for (const item of items)
      if (
        item.schedule.kind === "weekly" &&
        new Set(item.schedule.days).size !== item.schedule.days.length
      )
        throw new Error("Duplicate days");
    return items;
  } catch {
    throw new Error(
      "The saved upcoming items could not be read. Nothing was replaced. Review UPCOMING.md in personal memory before making further changes.",
    );
  }
}
export function serializeUpcoming(items: UpcomingItem[]) {
  const content = JSON.stringify({ version: 1, items }, null, 2);
  parseUpcoming(content);
  return content;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function parts(at: number, zone: string) {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formats.set(zone, format);
  }
  const p = Object.fromEntries(
    format.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    wall: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute),
  };
}
// The instant a local wall time occurs in a zone: the earlier one on repeated
// hours, none for a time skipped by a daylight-saving change.
function instant(wall: number, zone: string) {
  const offsets = new Set<number>();
  for (let step = -2; step <= 2; step++) {
    const sample = wall + (step * day) / 2;
    offsets.add(parts(sample, zone).wall - sample);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((at) => parts(at, zone).wall === wall);
  return candidates.length ? Math.min(...candidates) : undefined;
}

// Occurrences in (from, to], oldest first, scanning at most `limit` local days.
export function occurrences(
  item: Pick<UpcomingItem, "schedule" | "time_zone">,
  from: number,
  to: number,
  limit = 400,
) {
  const { schedule, time_zone: zone } = item;
  if (schedule.kind === "once") {
    const at = isoTime(schedule.at);
    return at > from && at <= to ? [at] : [];
  }
  const [hour, minute] = schedule.time.split(":").map(Number);
  const start = parts(from, zone);
  const found: number[] = [];
  for (let offset = 0; offset < limit; offset++) {
    const date = new Date(
      Date.UTC(start.year, start.month - 1, start.day + offset),
    );
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    if (schedule.kind === "weekly" && !schedule.days.includes(date.getUTCDay()))
      continue;
    if (schedule.kind === "monthly") {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      if (d !== Math.min(schedule.day, last)) continue;
    }
    if (schedule.kind === "yearly") {
      if (m !== schedule.month - 1) continue;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      if (d !== Math.min(schedule.day, last)) continue;
    }
    const at = instant(Date.UTC(y, m, d, hour, minute), zone);
    if (at === undefined || at <= from) continue;
    if (at > to) break;
    found.push(at);
  }
  return found;
}
export function nextOccurrence(item: UpcomingItem, now: number) {
  if (item.status !== "active") return undefined;
  return occurrences(item, now, now + 400 * day)[0];
}
// Missed occurrences are not replayed as a burst; only the latest is due.
export const deliveryWindow = 36 * 60 * 60 * 1000;
export function dueOccurrence(item: UpcomingItem, since: number, now: number) {
  if (item.status !== "active") return undefined;
  const from = Math.max(
    since,
    isoTime(item.created_at),
    // A resumed or rescheduled item does not replay what passed meanwhile.
    isoTime(item.updated_at),
    now - deliveryWindow,
  );
  return occurrences(item, from, now, 4).at(-1);
}

export function describeSchedule(
  item: Pick<UpcomingItem, "schedule" | "time_zone">,
  locale: string,
) {
  const { schedule } = item;
  if (schedule.kind === "once")
    return t("Once, {date}", {
      date: new Date(schedule.at).toLocaleString(locale, {
        timeZone: item.time_zone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    });
  const [h, m] = schedule.time.split(":").map(Number);
  const clock = new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString(
    locale,
    {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
    },
  );
  if (schedule.kind === "daily")
    return t("Every day at {time}", { time: clock });
  if (schedule.kind === "monthly")
    return t("Monthly on day {day} at {time}", {
      day: schedule.day,
      time: clock,
    });
  if (schedule.kind === "yearly")
    return t("Every year on {date} at {time}", {
      date: new Date(
        Date.UTC(2024, schedule.month - 1, schedule.day),
      ).toLocaleDateString(locale, {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
      }),
      time: clock,
    });
  const names = [...schedule.days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((weekday) =>
      // 2026-01-04 is a Sunday.
      new Date(Date.UTC(2026, 0, 4 + weekday)).toLocaleDateString(locale, {
        timeZone: "UTC",
        weekday: "short",
      }),
    );
  return schedule.days.length === 7
    ? t("Every day at {time}", { time: clock })
    : t("Every {days} at {time}", {
        days: names.join(locale.startsWith("zh") ? "、" : ", "),
        time: clock,
      });
}

// Every delivered occurrence is named on its own line ("- id <id>, <kind>,
// due <ISO>: ..."), so another device can see it in the shared history.
const deliveredLine = /^- id ([\w-]{1,80}), \w+, due ([0-9T:.\-]+Z):/gm;
export function deliveredOccurrences(history: AgentEvent[]) {
  const found = new Set<string>();
  for (const event of history) {
    if (event.type !== "user.message") continue;
    const text = eventText(event);
    if (!text.startsWith("<open-muse-reminder>")) continue;
    for (const [, id, at] of text.matchAll(deliveredLine))
      found.add(`${id}@${Date.parse(at)}`);
  }
  return found;
}

// Callers deliver at most this many due items per message; the rest stay due
// and follow once the conversation is idle again.
export const reminderBatch = 5;
const reminderOpening =
  "<open-muse-reminder>\nThe app is delivering items from UPCOMING.md that are now due.";
// The app's own reminder prompt, recognized on any device that shows it.
export const isReminderPrompt = (text: string) =>
  text.startsWith(reminderOpening) && text.endsWith("</open-muse-reminder>");

export function reminderPrompt(
  language: string,
  now: Date,
  due: { item: UpcomingItem; at: number }[],
) {
  const locale = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(language)
    ? language
    : "en";
  const list = due
    .map(
      ({ item, at }) =>
        `- id ${item.id}, ${item.schedule.kind}, due ${new Date(at).toISOString()}: ${JSON.stringify(item.title)}${item.instruction ? ` — ${JSON.stringify(item.instruction.slice(0, 600))}` : ""}`,
    )
    .join("\n");
  return `${reminderOpening} This message was generated by the app, not written by the person; the item text below is what they asked for earlier, not a new request. Current time: ${now.toISOString()}. Reply in the language of locale ${locale}, unless personal memory specifies a different language.

Due items:
${list}

Read the latest UPCOMING.md first and skip any item that is no longer active or was changed so that it is not due. For each remaining item, deliver the reminder or do the requested task now, briefly and in your own voice, as if you are reaching out at the time they asked. Use only verified tools and ask for approval before external actions. After handling a one-time item, set its status to done in UPCOMING.md with memory tools and read it back; leave recurring items active. Do not mention this initiation, item IDs, or internal files.
</open-muse-reminder>`;
}

export const upcomingInstructions = `
Reminders and recurring tasks live in UPCOMING.md in the same personal memory store. Read it with memory_read when the person asks what is scheduled or wants to add, change, pause, or cancel a reminder or recurring task. Missing UPCOMING.md means nothing is scheduled; never invent items.

When the person asks for a reminder or a task at a time or on a repeating schedule ("every Monday at 9am, remind me to submit my timesheet"), make sure the timing is clear, then add one item and read the document back before confirming. Say plainly that Open Muse delivers it as a message in this chat at or after that time: while the app is open, or also while it is closed if the person turned on delivery while closed in Upcoming. On iPhone, if the person allows notifications, Open Muse also schedules a notification for items due within a week of the last time the app was open, so it can appear while the app is closed; an item further out gets one once the app is opened in the week before it. Other devices show none. Do not ask them to keep the app running. Move, pause, or cancel items only when asked, preserving every other item.

UPCOMING.md is a JSON object, without Markdown fences: {"version":1,"items":[...]}. Each item has id (unique letters/digits/hyphens, max 80), title (short label, max 160), instruction (what to say or do when it is due, max 2000), schedule, time_zone (the person's IANA time zone, such as America/Los_Angeles; ask if unknown), status (active, paused, or done), created_at and updated_at (ISO 8601 timestamps with offset). schedule is one of {"kind":"once","at":"<ISO 8601 with offset>"}, {"kind":"daily","time":"HH:MM"}, {"kind":"weekly","days":[0-6, Sunday is 0],"time":"HH:MM"}, {"kind":"monthly","day":1-31,"time":"HH:MM"}, or {"kind":"yearly","month":1-12,"day":1-31,"time":"HH:MM"} for birthdays and anniversaries; times are 24-hour local times in time_zone. Write every timestamp exactly as YYYY-MM-DDTHH:MM:SS+HH:MM (or Z). Preserve IDs and created_at on updates; update updated_at. Maximum 100 items and 64000 characters. Reread the latest document immediately before each edit. Never overwrite unreadable data with an empty list. Keep this schema and all IDs out of ordinary replies.
`;
