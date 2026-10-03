import { iphoneDeclined } from "./iphone-tools";
import { stepTarget } from "./activity";
import {
  healthDeclined,
  healthMetricLabel,
  healthRangeLabel,
  parseHealthRequest,
} from "./health";
import { eventText, type AgentEvent } from "./types";

// A tool call the person answered: what it asked to do, how they answered,
// and when. These titles are UI labels; t() translates them where shown.
export interface ApprovalRecord {
  id: string;
  kind: "web" | "health" | "mac" | "iphone" | "tool";
  title: string;
  // The tool's own name, for titles that name it.
  tool: string;
  detail: string;
  result: "allow" | "deny";
  at: string;
  input: string;
}

function summary(event: AgentEvent) {
  const name = event.name ?? "";
  const input = (event as { input?: Record<string, unknown> }).input ?? {};
  if (name === "web_search") {
    const list = input.search_request_list;
    const first =
      Array.isArray(list) && typeof list[0]?.query === "string"
        ? (list[0].query as string)
        : typeof input.query === "string"
          ? input.query
          : "";
    return { kind: "web" as const, title: "Search the web", detail: first };
  }
  if (name === "web_fetch")
    return {
      kind: "web" as const,
      title: "Open this web page",
      detail: typeof input.url === "string" ? input.url : "",
    };
  if (name === "health_read") {
    // Which data and over which days, as the request card names them.
    const query = parseHealthRequest(event);
    return {
      kind: "health" as const,
      title: "Read Health data",
      detail: query
        ? `${healthMetricLabel(query.metric)} · ${healthRangeLabel(query)}`
        : stepTarget(event),
    };
  }
  if (name.startsWith("mac_"))
    return {
      kind: "mac" as const,
      title: "Use your Mac",
      detail: stepTarget(event),
    };
  if (name.startsWith("iphone_"))
    return {
      kind: "iphone" as const,
      title: "Use your iPhone",
      detail: stepTarget(event),
    };
  return {
    kind: "tool" as const,
    title: "Use {tool}",
    detail: stepTarget(event),
  };
}

// Device requests the person answers themselves: Apple Health reads on the
// iPhone and Mac actions on the Mac. A decline is reported to the agent with
// one of these openings.
const declined = [healthDeclined, iphoneDeclined, "The user declined"];
const reviewed = (name = "") =>
  name === "health_read" ||
  name.startsWith("mac_") ||
  name.startsWith("iphone_");

// Every answered request in a conversation, newest first: tool confirmations
// and the person's answers to device requests.
export function approvalHistory(events: readonly AgentEvent[]) {
  const calls = new Map(events.map((event) => [event.id, event]));
  const records: ApprovalRecord[] = [];
  for (const event of events) {
    if (event.type === "user.custom_tool_result") {
      const call = calls.get(String(event.custom_tool_use_id));
      if (!call || !reviewed(call.name)) continue;
      const text = eventText(event);
      records.push({
        id: event.id,
        ...summary(call),
        tool: call.name ?? "",
        result: declined.some((opening) => text.startsWith(opening))
          ? "deny"
          : "allow",
        at: event.created_at ?? event.processed_at ?? call.created_at ?? "",
        input: JSON.stringify((call as { input?: unknown }).input ?? {}),
      });
      continue;
    }
    if (event.type !== "user.tool_confirmation") continue;
    const call = calls.get(String(event.tool_use_id));
    if (!call) continue;
    records.push({
      id: event.id,
      ...summary(call),
      tool: call.name ?? "",
      result: event.result === "deny" ? "deny" : "allow",
      at: event.created_at ?? event.processed_at ?? call.created_at ?? "",
      input: JSON.stringify((call as { input?: unknown }).input ?? {}),
    });
  }
  return records.reverse();
}
