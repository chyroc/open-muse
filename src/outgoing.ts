import {
  messageAttachments,
  type SentAttachment,
} from "../shared/attachments";
import { eventText, type AgentEvent } from "../shared/types";

// A message on its way: shown in the chat as soon as it is sent, until the
// conversation's history has it. `view` is the draft key of the chat it was
// sent from, or the new conversation's id once one is opened for it. Photos
// and files sent with it show in its bubble from the start, and `files`
// names their uploads once they are done.
export type Outgoing = {
  view: string;
  text: string;
  at: number;
  attachments?: SentAttachment[];
  files?: string[];
};

// Whether a history event is the message that was sent: the same text and
// uploads, written by the person, no earlier than a little before it was
// sent. A message whose uploads are not done yet is not in the history.
export function isEcho(event: AgentEvent, sent: Outgoing) {
  if (sent.attachments?.length && !sent.files) return false;
  const files = new Set(messageAttachments(event).map(({ key }) => key));
  return (
    event.type === "user.message" &&
    eventText(event) === sent.text &&
    (sent.files ?? []).every((file) => files.has(file)) &&
    Date.parse(event.created_at ?? event.processed_at ?? "") >=
      sent.at - 120_000
  );
}

// The message to show as being sent in this chat, if any.
export function pendingOutgoing(
  outgoing: Outgoing | undefined,
  view: string,
  messages: AgentEvent[],
) {
  return outgoing &&
    outgoing.view === view &&
    !messages.some((event) => isEcho(event, outgoing))
    ? outgoing
    : undefined;
}
