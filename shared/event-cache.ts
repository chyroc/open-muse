import type { AgentEvent } from "./types";

const isMessage = (event: AgentEvent) =>
  event.type === "user.message" || event.type === "agent.message";

// The part of a conversation kept on the device so it opens at once.
// Messages are what the chat shows, so the latest 300 are kept however many
// tool steps came between them; other events only the latest 200. Order is
// unchanged.
export function eventsToKeep(events: readonly AgentEvent[]) {
  const messages = new Set(events.filter(isMessage).slice(-300));
  const others = new Set(events.filter((e) => !isMessage(e)).slice(-200));
  return events.filter((event) => messages.has(event) || others.has(event));
}
