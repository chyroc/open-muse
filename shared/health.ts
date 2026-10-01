import { z } from "zod";
import { formatLocale, t } from "./i18n";
import type { AgentEvent } from "./types";

// Apple Health reads are an MA custom tool answered by the iPhone app. The
// agent asks; the person shares each request explicitly; the app answers with
// the summary HealthKit returned.
export const healthMetrics = [
  "steps",
  "active_energy",
  "exercise_minutes",
  "walking_running_distance",
  "heart_rate",
  "resting_heart_rate",
  "sleep",
  "workouts",
  "body_mass",
] as const;
export type HealthMetric = (typeof healthMetrics)[number];

export const healthToolName = "health_read";
export const healthToolSpec = {
  name: healthToolName,
  description:
    "Read the person's Apple Health data from their iPhone for one metric and time range. The Open Muse iPhone app answers after the person explicitly shares the request, so it may wait until the app is open. Use it when the person asks about their activity, workouts, sleep, heart rate, or weight; never guess these values. Cumulative metrics return sums, heart rate and weight return average/min/max, sleep returns minutes asleep and in bed, and workouts return a list. An empty result can mean no data or that Health access was not allowed.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["metric", "start", "end"],
    properties: {
      metric: { type: "string", enum: [...healthMetrics] },
      start: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 start with offset, in the person's time zone.",
      },
      end: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 end with offset; at most 366 days after start.",
      },
      granularity: {
        type: "string",
        enum: ["total", "day", "hour"],
        description:
          "Bucket size. Defaults to total for a day or less, otherwise day. Hourly ranges are limited to 16 days.",
      },
    },
  },
} as const;

const day = 86400000;
export const healthQueryInput = z
  .object({
    metric: z.enum(healthMetrics),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    granularity: z.enum(["total", "day", "hour"]).optional(),
  })
  .strict()
  .transform((query, context) => {
    const start = Date.parse(query.start);
    const end = Date.parse(query.end);
    const granularity =
      query.granularity ?? (end - start > day ? "day" : "total");
    if (!(end > start) || end - start > 366 * day)
      context.addIssue({ code: "custom", message: "Invalid time range" });
    if (granularity === "hour" && end - start > 16 * day)
      context.addIssue({ code: "custom", message: "Hourly range too long" });
    return { ...query, granularity, startMs: start, endMs: end };
  });
export type HealthQuery = z.output<typeof healthQueryInput>;

export function isHealthRequest(event: AgentEvent) {
  return (
    event.type === "agent.custom_tool_use" && event.name === healthToolName
  );
}
export function parseHealthRequest(event: AgentEvent) {
  const result = healthQueryInput.safeParse(event.input);
  return result.success ? result.data : undefined;
}

const labels: Record<HealthMetric, string> = {
  steps: "Steps",
  active_energy: "Active energy",
  exercise_minutes: "Exercise minutes",
  walking_running_distance: "Walking + running distance",
  heart_rate: "Heart rate",
  resting_heart_rate: "Resting heart rate",
  sleep: "Sleep",
  workouts: "Workouts",
  body_mass: "Weight",
};
export const healthMetricLabel = (metric: HealthMetric) => t(labels[metric]);

export function healthRangeLabel(query: HealthQuery, locale = formatLocale()) {
  const start = new Date(query.startMs);
  // An end at midnight closes the previous day.
  const end = new Date(query.endMs - 1);
  const sameDay = start.toDateString() === end.toDateString();
  const date: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const time: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const wholeDays =
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    new Date(query.endMs).getHours() === 0 &&
    new Date(query.endMs).getMinutes() === 0;
  if (sameDay)
    return wholeDays
      ? start.toLocaleDateString(locale, date)
      : `${start.toLocaleDateString(locale, date)} ${start.toLocaleTimeString(locale, time)} – ${end.toLocaleTimeString(locale, time)}`;
  return `${start.toLocaleDateString(locale, date)} – ${end.toLocaleDateString(locale, date)}`;
}

export const healthDeclined =
  "The person chose not to share this Apple Health data. Do not ask again unless they bring it up.";
export const healthInvalid =
  "The request was invalid and was not run. Use one supported metric and an ISO 8601 start and end with offset, at most 366 days apart (16 days for hourly).";
