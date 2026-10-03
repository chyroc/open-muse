import { stepTarget } from "./activity";
import type { AgentEvent } from "./types";

// A tool call the person answered: what it asked to do, how they answered,
// and when. These titles are UI labels; t() translates them where shown.
export interface ApprovalRecord {
  id: string;
  kind: "web" | "health" | "mac" | "tool";
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
  if (name === "health_read")
    return {
      kind: "health" as const,
      title: "Read Health data",
      detail: stepTarget(event),
    };
  if (name.startsWith("mac_"))
    return {
      kind: "mac" as const,
      title: "Use your Mac",
      detail: stepTarget(event),
    };
  return {
    kind: "tool" as const,
    title: "Use {tool}",
    detail: stepTarget(event),
  };
}

// Every answered request in a conversation, newest first.
export function approvalHistory(events: readonly AgentEvent[]) {
  const calls = new Map(events.map((event) => [event.id, event]));
  const records: ApprovalRecord[] = [];
  for (const event of events) {
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
