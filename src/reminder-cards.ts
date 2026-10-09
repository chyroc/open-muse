import { isoTime, type UpcomingItem } from "../shared/upcoming";
import { eventText, type AgentEvent } from "../shared/types";

const input = (event: AgentEvent) =>
  JSON.stringify((event as { input?: unknown }).input ?? "");

// Reminders the companion set up in a conversation, by the reply they belong
// to. An item belongs to the turn whose memory write first carries its id in
// UPCOMING.md, and its card goes under the last reply of that turn after the
// write, so it sits right under "Done, I'll remind you…". Items made in
// another conversation never appear in this one's writes and show no card.
// The times an item records are written by the companion and can be minutes
// off, so they only rule out a write far from them, such as a later rewrite
// of the whole list when the item's own turn is not loaded. An item changed
// in this conversation, rather than created, goes under the reply to the
// write near its update time.
export function remindersByReply(
  items: readonly UpcomingItem[],
  events: readonly AgentEvent[],
) {
  const found = new Map<string, UpcomingItem[]>();
  const writes = events.flatMap((event, index) =>
    event.type === "agent.tool_use" &&
    /^memory_/.test(event.name ?? "") &&
    input(event).includes("UPCOMING.md")
      ? [
          {
            index,
            text: input(event),
            at: Date.parse(event.created_at ?? event.processed_at ?? ""),
          },
        ]
      : [],
  );
  const near = (at: number, time: string) =>
    Math.abs(at - isoTime(time)) <= 30 * 60_000;
  for (const item of items) {
    const mentions = writes.filter(({ text }) => text.includes(item.id));
    // Set up in this conversation, or changed in it since: a reminder the
    // companion updated, such as merging a request into an existing one,
    // shows under the reply that changed it.
    const first =
      mentions.find(({ at }) => near(at, item.created_at)) ??
      [...mentions].reverse().find(({ at }) => near(at, item.updated_at));
    if (!first) continue;
    let reply: string | undefined;
    for (let index = first.index + 1; index < events.length; index++) {
      const event = events[index];
      if (event.type === "user.message") break;
      if (event.type === "agent.message" && eventText(event).trim())
        reply = event.id;
    }
    if (reply) found.set(reply, [...(found.get(reply) ?? []), item]);
  }
  return found;
}
