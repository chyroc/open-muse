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
  // Set on the sessions that produce Feed or Ideas. They open from those
  // pages and are kept out of the side-chat list.
  generation?: "feed" | "ideas";
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
  custom_tool_use_id?: string;
  session_thread_id?: string;
  result?: "allow" | "deny";
  // Local audit marker; not sent to Ark.
  approval_source?: "automatic";
  // Historical UI provenance only; never sent to MA as an event.
  source_session_id?: string;
  source_event_id?: string;
  // Device-local answer receipt, never trusted from upstream or sent to MA.
  choice_reply?: import("./chat-choices").ChoiceReply;
  // Verified app-generated MA initiation; retained in execution history.
  app_initiation?: "welcome" | "checkin" | "reminder" | "browser" | "webhook";
  welcome_reply?: boolean;
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
  // Why an account workspace needs the user's decision, if it does.
  review?: "settings" | "rebuild" | "unconfirmed" | "drift";
}

// The companion can react to the person's message with one emoji by opening
// its reply with [[react:👍]]: the app shows the emoji on that message, and
// the mark never shows as text.
const reactionMark = /^\s*\[\[react:([^\]\s]{1,16})\]\]\s*/u;
function rawText(event: AgentEvent) {
  return (
    event.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}
export function eventText(event: AgentEvent): string {
  const text = rawText(event);
  return event.type === "agent.message" ? text.replace(reactionMark, "") : text;
}
// The emoji a reply opens its reaction mark with, if it is one.
export function companionReaction(event: AgentEvent) {
  if (event.type !== "agent.message") return undefined;
  const emoji = reactionMark.exec(rawText(event))?.[1];
  return emoji && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : undefined;
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

// History is authoritative for persisted annotations. Preserve only SSE rows
// that arrived while the read was in flight, not an entire stale local snapshot.
export function mergeHistorySnapshot(
  beforeRead: AgentEvent[],
  current: AgentEvent[],
  history: AgentEvent[],
) {
  const before = new Map(beforeRead.map((event) => [event.id, event]));
  return mergeEvents(
    history,
    current.filter((event) => before.get(event.id) !== event),
  );
}

// A read of the latest part of a conversation is authoritative for the span
// it covers; events before that span, such as earlier ones loaded as the
// person scrolled up, stay.
export function mergeHistoryWindow(
  beforeRead: AgentEvent[],
  current: AgentEvent[],
  history: AgentEvent[],
) {
  if (!history.length) return current;
  const time = (event: AgentEvent) =>
    event.processed_at ?? event.created_at ?? "";
  const from = history.reduce(
    (earliest, event) => (time(event) < earliest ? time(event) : earliest),
    time(history[0]),
  );
  const before = new Map(beforeRead.map((event) => [event.id, event]));
  return mergeEvents(
    history,
    current.filter(
      (event) => time(event) < from || before.get(event.id) !== event,
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

// The calls the session is blocked on, if its latest status asks for action.
function blockingIds(events: AgentEvent[]) {
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
    return new Set<string>();
  return new Set(lastStatus.stop_reason.event_ids ?? []);
}

// Custom tool calls also block the session, but they are answered with a
// tool result from the client that runs them, never with a confirmation.
export function pendingPermissions(events: AgentEvent[]) {
  const ids = blockingIds(events);
  const confirmed = new Set(
    events
      .filter((event) => event.type === "user.tool_confirmation")
      .map((event) => event.tool_use_id),
  );
  return events.filter(
    (event) =>
      ids.has(event.id) &&
      !confirmed.has(event.id) &&
      event.type !== "agent.custom_tool_use",
  );
}

export function pendingCustomTools(events: AgentEvent[]) {
  const ids = blockingIds(events);
  const answered = new Set(
    events
      .filter((event) => event.type === "user.custom_tool_result")
      .map((event) => event.custom_tool_use_id),
  );
  return events.filter(
    (event) =>
      event.type === "agent.custom_tool_use" &&
      ids.has(event.id) &&
      !answered.has(event.id),
  );
}
