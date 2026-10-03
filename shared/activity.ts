import { eventText, type AgentEvent } from "./types";
import { toolLabel } from "./companion-activity";

// One request the companion acted on: the person's message, the tools it
// used, and how it answered.
export interface ActivityTurn {
  id: string;
  request: string;
  reply: string;
  error?: string;
  tools: number;
  // Set when the app, not the person, started this turn.
  initiation?: AgentEvent["app_initiation"];
  at: string;
  events: AgentEvent[];
}

const toolTypes = new Set([
  "agent.tool_use",
  "agent.mcp_tool_use",
  "agent.custom_tool_use",
]);

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
      .find(Boolean) ?? ""
  );
}

// Splits a conversation into turns at each user message and keeps the turns
// in which a tool ran, newest first.
export function activityTurns(events: AgentEvent[]): ActivityTurn[] {
  const turns: ActivityTurn[] = [];
  let current: ActivityTurn | undefined;
  for (const event of events) {
    if (event.type === "user.message") {
      current = {
        id: event.id,
        request: event.app_initiation ? "" : firstLine(eventText(event)),
        initiation: event.app_initiation,
        reply: "",
        tools: 0,
        at: event.created_at ?? event.processed_at ?? "",
        events: [],
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    current.events.push(event);
    if (toolTypes.has(event.type)) current.tools++;
    if (event.type === "agent.message") {
      const line = plainText(firstLine(eventText(event)));
      if (line) current.reply = line;
    }
    if (event.error?.message) current.error = event.error.message;
  }
  return turns.filter((turn) => turn.tools > 0).reverse();
}

export type ActivityDay = "today" | "yesterday" | "week" | "earlier";

// How far back a turn was, by calendar day in local time.
export function activityDay(at: string, now = new Date()): ActivityDay {
  const date = new Date(at);
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  return days <= 0
    ? "today"
    : days === 1
      ? "yesterday"
      : days < 7
        ? "week"
        : "earlier";
}

// Text without Markdown marks, for one-line titles and summaries.
export function plainText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/^[#>\-\s]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "1:47am", as activity lists show times.
export function clockTime(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour % 12 || 12}:${minute}${hour < 12 ? "am" : "pm"}`;
}

// One tool call of a turn, as a step in its detail: what was used and on
// what, the narration that introduced it, and how it ended.
export interface ActivityStep {
  id: string;
  label: string;
  target: string;
  note: string;
  state: "done" | "failed" | "running";
  input: string;
  result: string;
}

export function stepTarget(event: AgentEvent) {
  const input = (event as { input?: Record<string, unknown> }).input ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const url = text(input.url);
  if (url)
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  const path = text(input.file_path) || text(input.path);
  if (path) return path.split("/").filter(Boolean).at(-1) ?? path;
  return (
    text(input.query) ||
    text(input.pattern) ||
    text(input.command).split("\n")[0] ||
    text(input.metric)
  ).slice(0, 80);
}

export function activitySteps(turn: ActivityTurn, running: boolean) {
  const steps: ActivityStep[] = [];
  let narration = "";
  const results = new Map<string, AgentEvent>();
  for (const event of turn.events)
    if (event.type.endsWith("tool_result"))
      results.set(
        String((event as { tool_use_id?: unknown }).tool_use_id),
        event,
      );
  for (const event of turn.events) {
    if (event.type === "agent.message") {
      narration = plainText(eventText(event));
      continue;
    }
    // Reading and updating memory is quiet bookkeeping, not a step.
    if (!toolTypes.has(event.type) || event.name?.startsWith("memory_"))
      continue;
    const result = results.get(event.id);
    const failed = Boolean(
      (result as { is_error?: unknown } | undefined)?.is_error,
    );
    steps.push({
      id: event.id,
      label: toolLabel(event),
      target: stepTarget(event),
      note: narration,
      state: result
        ? failed
          ? "failed"
          : "done"
        : running
          ? "running"
          : "done",
      input: JSON.stringify(
        (event as { input?: unknown }).input ?? {},
        null,
        2,
      ).slice(0, 2000),
      result: result ? eventText(result).slice(0, 2000) : "",
    });
    narration = "";
  }
  return steps;
}
