import { eventText, type AgentEvent } from "./types";

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
      const line = firstLine(eventText(event));
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
