import type { InspirationItem } from "../../shared/inspiration";

// The post or idea a message's card points at: by id, or for messages sent
// before cards carried ids, by title.
export function focusedItem(
  items: InspirationItem[],
  focus: { id?: string; title?: string } | undefined,
) {
  if (!focus) return undefined;
  return focus.id
    ? items.find((item) => item.id === focus.id)
    : items.find((item) => item.title === focus.title);
}

// The hash that brings a post or idea into view.
export function focusPath(
  page: "feed" | "ideas",
  card: { id?: string; title?: string },
) {
  if (card.id) return `/${page}/id/${encodeURIComponent(card.id)}`;
  if (card.title) return `/${page}/title/${encodeURIComponent(card.title)}`;
  return `/${page}`;
}
