import { isoTime, type UpcomingItem } from "../shared/upcoming";
import type { AgentEvent } from "../shared/types";

const at = (event: AgentEvent) =>
  Date.parse(event.created_at ?? event.processed_at ?? "");

// Reminders the companion set up in a conversation, by the reply they belong
// to: an item goes under the last of the replies that follow its creation in
// the same turn, so the card sits right under "Done, I'll remind you…".
// Items made much earlier, or in another conversation, match no reply here.
export function remindersByReply(
  items: readonly UpcomingItem[],
  messages: readonly AgentEvent[],
) {
  const found = new Map<string, UpcomingItem[]>();
  for (const item of items) {
    const created = isoTime(item.created_at);
    if (!Number.isFinite(created)) continue;
    const first = messages.findIndex(
      (event) =>
        event.type === "agent.message" &&
        at(event) >= created - 5_000 &&
        at(event) - created <= 10 * 60_000,
    );
    if (first < 0) continue;
    // The turn the reply ends began before the item was made.
    let asked = first - 1;
    while (asked >= 0 && messages[asked].type !== "user.message") asked--;
    if (asked < 0 || at(messages[asked]) > created + 5_000) continue;
    let last = first;
    while (messages[last + 1]?.type === "agent.message") last++;
    const id = messages[last].id;
    found.set(id, [...(found.get(id) ?? []), item]);
  }
  return found;
}
