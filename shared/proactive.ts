import { z } from "zod";

// App-generated messages that start a turn in the main chat: check-ins,
// Upcoming reminders, and goal follow-ups. With an Open Muse account, every
// sender (each app and the service) claims one key per message with the
// service first; the first claim wins and the others send nothing.
export const claimKinds = ["checkin", "reminder", "goal"] as const;
export type ClaimKind = (typeof claimKinds)[number];
// A local date (YYYY-MM-DD), an item and occurrence ("standup@1767000000000"),
// or a goal and local date. Never personal text.
export const claimKeyPattern = /^[\w.:@+-]{1,120}$/;
// Claims are kept long enough to outlast every window they guard (a reminder
// occurrence is due for 36 hours, a goal is followed up at most weekly).
export const claimRetention = 8 * 86_400_000;

export const claimInput = z
  .object({
    kind: z.enum(claimKinds),
    key: z.string().regex(claimKeyPattern),
    session_id: z.string().regex(/^[\w-]{1,200}$/),
  })
  .strict();
export type ClaimInput = z.infer<typeof claimInput>;
export const claimResult = z.union([
  z.object({ claimed: z.literal(true) }),
  z.object({
    claimed: z.literal(false),
    by: z.enum(["app", "service"]),
    age_ms: z.number().nonnegative(),
  }),
]);
export type ClaimResult = z.infer<typeof claimResult>;

export const reminderClaimKey = (item: string, occurrence: number) =>
  `${item}@${occurrence}`;
export const goalClaimKey = (goal: string, day: string) => `${goal}@${day}`;

// A date as YYYY-MM-DD in the given IANA time zone, or the device's own when
// none is given.
export function localDay(now: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// The hour (0-23) in the given IANA time zone, or the device's own.
export function localHour(now: number, timeZone?: string) {
  if (!timeZone) return new Date(now).getHours();
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(new Date(now))
    .find((entry) => entry.type === "hour")?.value;
  return Number(hour) % 24;
}

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
