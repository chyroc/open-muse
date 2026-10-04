import { isoTime, type UpcomingItem } from "../shared/upcoming";
import { eventText, type AgentEvent } from "../shared/types";

const input = (event: AgentEvent) =>
  JSON.stringify((event as { input?: unknown }).input ?? "");

// Reminders the companion set up in a conversation, by the reply they belong
// to. An item belongs to the turn whose memory write first carries its id in
// UPCOMING.md, and its card goes under the last reply of that turn after the
// write, so it sits right under "Done, I'll remind you…". Items made in
// another conversation never appear in this one's writes and show no card.
// The time an item records as its creation is written by the companion and
// can be minutes off, so it only rules out a write far from it, such as a
// later rewrite of the whole list when the item's own turn is not loaded.
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
  for (const item of items) {
    const first = writes.find(({ text }) => text.includes(item.id));
    if (!first || Math.abs(first.at - isoTime(item.created_at)) > 30 * 60_000)
      continue;
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
