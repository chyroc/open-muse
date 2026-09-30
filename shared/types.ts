export type Mode = "disconnected" | "ark";
export type SessionStatus = "idle" | "running" | "rescheduling" | "terminated";
export type Category = "general" | "research" | "writing" | "life" | "code";
export interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  category: Category;
  preview?: string;
}
export interface AgentEvent {
  id: string;
  type: string;
  processed_at?: string;
  created_at?: string;
  content?: { type: string; text?: string }[];
  name?: string;
  input?: unknown;
  evaluated_permission?: "allow" | "ask" | "deny";
  tool_use_id?: string;
  mcp_tool_use_id?: string;
  session_thread_id?: string;
  result?: "allow" | "deny";
  // Local audit marker; not sent to Ark.
  approval_source?: "automatic";
  // Historical UI provenance only; never sent to MA as an event.
  source_session_id?: string;
  source_event_id?: string;
  is_error?: boolean;
  error?: { message?: string; type?: string };
  stop_reason?: { type: string; event_ids?: string[] };
}
export interface Page<T> {
  data: T[];
  next_page?: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  category?: import("./goals").GoalCategory;
  parent_id?: string;
  status: "active" | "paused" | "completed";
  steps: { id: string; title: string; done: boolean }[];
  session_id?: string;
  created_at: string;
  updated_at: string;
}
export interface LibraryItem {
  id: string;
  title: string;
  text: string;
  session_id: string;
  event_id: string;
  created_at: string;
}
export interface AppConfig {
  mode: Mode;
  agentConfigured: boolean;
  authRequired: boolean;
}
export interface WorkspaceStatus {
  state: "disconnected" | "idle" | "preparing" | "ready" | "error";
  message: string;
}

export function eventText(event: AgentEvent): string {
  return (
    event.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

export function mergeEvents(
  current: AgentEvent[],
  incoming: AgentEvent[],
): AgentEvent[] {
  const unique = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) unique.set(event.id, event);
  return [...unique.values()].sort((a, b) =>
    (a.processed_at ?? a.created_at ?? "").localeCompare(
      b.processed_at ?? b.created_at ?? "",
    ),
  );
}

export function taskState(
  events: AgentEvent[],
  status: SessionStatus = "idle",
) {
  let state:
    "idle" | "running" | "complete" | "attention" | "error" | "stopped" =
    status === "running" || status === "rescheduling"
      ? "running"
      : status === "terminated"
        ? "stopped"
        : "idle";
  for (const event of events) {
    if (
      event.type === "session.status_running" ||
      event.type === "session.status_rescheduled"
    )
      state = "running";
    if (event.type === "session.error") state = "error";
    if (event.type === "user.interrupt") state = "stopped";
    if (event.type === "session.status_terminated") state = "stopped";
    if (event.type === "session.status_idle") {
      state =
        event.stop_reason?.type === "requires_action"
          ? "attention"
          : event.stop_reason?.type === "retries_exhausted"
            ? "error"
            : state === "stopped"
              ? "stopped"
              : "complete";
    }
  }
  return state;
}

export function pendingPermissions(events: AgentEvent[]) {
  const lastStatus = [...events]
    .reverse()
    .find(
      (event) =>
        event.type.startsWith("session.status_") ||
        event.type === "user.interrupt",
    );
  if (
    lastStatus?.type !== "session.status_idle" ||
    lastStatus.stop_reason?.type !== "requires_action"
  )
    return [];
  const ids = new Set(lastStatus.stop_reason.event_ids ?? []);
  const confirmed = new Set(
    events
      .filter((event) => event.type === "user.tool_confirmation")
      .map((event) => event.tool_use_id),
  );
  return events.filter(
    (event) => ids.has(event.id) && !confirmed.has(event.id),
  );
}
