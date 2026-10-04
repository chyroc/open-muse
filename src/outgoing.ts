import { eventText, type AgentEvent } from "../shared/types";

// A message on its way: shown in the chat as soon as it is sent, until the
// conversation's history has it. `view` is the draft key of the chat it was
// sent from, or the new conversation's id once one is opened for it.
export type Outgoing = { view: string; text: string; at: number };

// Whether a history event is the message that was sent: the same text,
// written by the person, no earlier than a little before it was sent.
export function isEcho(event: AgentEvent, sent: Outgoing) {
  return (
    event.type === "user.message" &&
    eventText(event) === sent.text &&
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
