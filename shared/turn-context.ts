// Model-facing context sent with each of the person's messages: their local
// time and time zone, and which Open Muse app they are writing from, so the
// agent resolves "today" correctly and only reaches for device tools that can
// answer.
export type Surface = "iphone" | "mac" | "web";

const surfaceNotes: Record<Surface, string> = {
  iphone:
    "They are writing from the Open Muse iPhone app, which answers health_read and the iphone_* tools. The mac_* tools are answered only by the Open Muse Mac app, which may not be running; use them only when the person asks for something on their Mac.",
  mac: "They are writing from the Open Muse Mac app, which answers the mac_* tools. health_read and the iphone_* tools are answered by their Open Muse iPhone app, which may not be open.",
  web: "They are writing from the Open Muse web app. Device tools are answered only by their Open Muse iPhone or Mac app, which may not be open; use them only when the request needs that device.",
};

function zoneName(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return "UTC";
  }
}

// "Friday, October 2, 2026, 20:17 (Asia/Shanghai, GMT+08:00)"
export function localTime(now: Date, timeZone: string) {
  const zone = zoneName(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const offset =
    part("timeZoneName") === "GMT" ? "GMT+00:00" : part("timeZoneName");
  return `${part("weekday")}, ${part("month")} ${part("day")}, ${part("year")}, ${part("hour")}:${part("minute")} (${zone}, ${offset})`;
}

export function turnContext(now: Date, timeZone: string, surface: Surface) {
  return [
    "<open-muse-context>",
    `The person's local time is ${localTime(now, timeZone)}. Use it for "today", "this week" and other relative dates, and give tools times in this time zone; their location is not needed to know the time.`,
    surfaceNotes[surface],
    "Write everything the person sees in the language of their message, including short notes before or between tool calls.",
    "</open-muse-context>",
  ].join("\n");
}
