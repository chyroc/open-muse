import { HttpError } from "./env";

const minute = 60000;
const day = 86400000;
export function validateTime(
  timezone: unknown,
  time: unknown,
): asserts timezone is string {
  if (
    typeof timezone !== "string" ||
    timezone.length > 80 ||
    typeof time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new HttpError(400, "Choose a valid timezone and daily time.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new HttpError(400, "Choose a valid timezone.");
  }
}

// Daily local time, not a fixed 24-hour interval. Skip nonexistent DST times;
// choose the next occurrence on repeated hours. Cron is only a wake-up signal.
export function nextDaily(now: number, timezone: string, time: string): number {
  validateTime(timezone, time);
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (t: number) =>
    Object.fromEntries(format.formatToParts(t).map((p) => [p.type, p.value]));
  const local = parts(now);
  const [h, m] = time.split(":").map(Number);
  const base = Date.UTC(+local.year, +local.month - 1, +local.day, h, m);
  for (let d = 0; d < 4; d++) {
    const nominal = base + d * day;
    const offsets = new Set<number>();
    for (let step = -3; step <= 3; step++) {
      const sample = nominal + (step * day) / 2;
      const p = parts(sample);
      offsets.add(
        Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - sample,
      );
    }
    const candidates = [...offsets]
      .map((offset) => nominal - offset)
      .filter((t) => {
        const p = parts(t);
        return (
          t > now &&
          Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) ===
            nominal
        );
      });
    if (candidates.length) return Math.min(...candidates);
  }
  throw new HttpError(400, "Could not calculate the next local occurrence.");
}

export const POLL_INTERVAL = 5 * minute;
// A run is checked again one tick later. The clock fires every POLL_INTERVAL
// but not to the millisecond, so the next check is due a little early: a tick
// arriving a second sooner must not skip the run for a whole interval.
export const RECHECK_AFTER = POLL_INTERVAL - minute;
export const RUN_DEADLINE = 60 * minute;
export const DAILY_RUN_LIMIT = 3;
