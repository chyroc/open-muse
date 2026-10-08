// The in-app notification list: what happened while the person was not
// watching. Reminders, check-ins, goal follow-ups, and incoming events reach
// the main chat as app-generated messages; each one the companion has answered
// becomes a notice, read from history rather than kept separately. Replies
// that finished while the app was in the background are recorded on the
// device when they are announced.
import { parseChoiceMessage } from "./chat-choices";
import { isCheckInPrompt } from "./checkin";
import { isGoalFollowUpPrompt } from "./goal-followup";
import { eventText, type AgentEvent } from "./types";
import { isReminderPrompt } from "./upcoming";
import { isWebhookPrompt } from "./webhooks";

export type NoticeKind =
  "reminder" | "check-in" | "goal" | "lark" | "event" | "reply";

export interface Notice {
  // The companion's reply, which identifies the notice.
  id: string;
  kind: NoticeKind;
  session_id: string;
  at: string;
  preview: string;
}

// What the device keeps: background replies it announced, and how far the
// person has read or cleared the list.
export interface NoticeRecords {
  replies: Notice[];
  readAt?: string;
  clearedAt?: string;
}
export const emptyNoticeRecords = (): NoticeRecords => ({ replies: [] });
export const noticeKey = (scope: string) => `${scope}:notices:v1`;
// Background replies kept on the device, newest first.
export const noticeReplyLimit = 30;

function noticeKind(text: string): NoticeKind | undefined {
  if (isReminderPrompt(text)) return "reminder";
  if (isCheckInPrompt(text)) return "check-in";
  if (isGoalFollowUpPrompt(text)) return "goal";
  if (isWebhookPrompt(text))
    return text.includes("Lark (Feishu) message channel") ? "lark" : "event";
  return undefined;
}

// A reply as one short line: plain text, without Markdown marks, and a
// question with options as its text and the question.
export function noticePreview(text: string, limit = 160) {
  const message = parseChoiceMessage(text);
  const readable = message.choice
    ? [message.before, message.choice.question, message.after]
        .filter(Boolean)
        .join(" ")
    : message.text;
  const plain = readable
    .replace(/[`*_#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}

// The app-generated messages in a conversation that the companion answered,
// newest first. One still waiting for its answer is not a notice yet.
export function noticesFromHistory(
  events: readonly AgentEvent[],
  sessionId: string,
): Notice[] {
  const notices: Notice[] = [];
  let pending: NoticeKind | undefined;
  for (const event of events) {
    if (event.type === "user.message") {
      pending = noticeKind(eventText(event));
      continue;
    }
    if (!pending || event.type !== "agent.message") continue;
    const text = eventText(event).trim();
    if (!text) continue;
    notices.push({
      id: event.id,
      kind: pending,
      session_id: sessionId,
      at: event.processed_at ?? event.created_at ?? new Date(0).toISOString(),
      preview: noticePreview(text),
    });
    pending = undefined;
  }
  return notices.reverse();
}

// The list as shown: notices from history and recorded replies together,
// newest first, without ones cleared away or seen twice.
export function noticeList(
  fromHistory: readonly Notice[],
  records: NoticeRecords,
): Notice[] {
  const seen = new Set<string>();
  return [...fromHistory, ...records.replies]
    .filter((notice) => !records.clearedAt || notice.at > records.clearedAt)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .filter((notice) => !seen.has(notice.id) && Boolean(seen.add(notice.id)));
}

export function unreadNotices(list: readonly Notice[], records: NoticeRecords) {
  return list.filter((notice) => !records.readAt || notice.at > records.readAt)
    .length;
}
