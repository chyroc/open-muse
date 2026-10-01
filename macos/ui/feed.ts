import { formatLocale, t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import type { InspirationItem } from "../../shared/inspiration";
import { LocalDatabase } from "../../src/direct/storage";
import { macOwner } from "./owner";

export type FeedPresentation = {
  hidden: string[];
  order: Record<string, string[]>;
};
export const emptyFeedPresentation = (): FeedPresentation => ({
  hidden: [],
  order: {},
});
export type FeedMove = "up" | "down" | "top";
const presentationDatabase = new LocalDatabase();

export function editionKey(item: InspirationItem) {
  const date = new Date(item.created_at);
  if (!Number.isFinite(date.getTime())) return "undated";
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join(
    "-",
  );
  const hour = date.getHours();
  return `${day}:${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`;
}

export function feedEditions(
  items: InspirationItem[],
  presentation: FeedPresentation,
) {
  const groups = new Map<
    string,
    { key: string; label: string; items: InspirationItem[] }
  >();
  const sorted = items
    .filter(
      (item) => item.kind === "feed" && !presentation.hidden.includes(item.id),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
    );
  for (const item of sorted) {
    const key = editionKey(item);
    let group = groups.get(key);
    if (!group) {
      const date = new Date(item.created_at);
      const period = key.split(":")[1];
      group = {
        key,
        label:
          key === "undated"
            ? t("Earlier posts")
            : `${date.toLocaleDateString(formatLocale(), { weekday: "long", month: "short", day: "numeric" })} ${t(period)}`,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values()) {
    const order = presentation.order[group.key] ?? [];
    const rank = (id: string) =>
      order.includes(id) ? order.indexOf(id) : Number.MAX_SAFE_INTEGER;
    group.items.sort((a, b) => rank(a.id) - rank(b.id));
  }
  return [...groups.values()];
}

export function moveFeedItem(
  state: FeedPresentation,
  items: InspirationItem[],
  id: string,
  direction: FeedMove,
): FeedPresentation {
  const group = feedEditions(items, state).find((group) =>
    group.items.some((item) => item.id === id),
  );
  if (!group) return state;
  const order = group.items.map((item) => item.id);
  const current = order.indexOf(id);
  const next =
    direction === "top"
      ? 0
      : Math.max(
          0,
          Math.min(order.length - 1, current + (direction === "up" ? -1 : 1)),
        );
  order.splice(current, 1);
  order.splice(next, 0, id);
  return { ...state, order: { ...state.order, [group.key]: order } };
}

// This is a Mac-only presentation overlay. It never edits generated MA events.
// The namespace follows the shared client's account/project isolation contract.
export function feedPresentationStore(
  client: Client,
  db = presentationDatabase,
) {
  const key = `${macOwner(client)}:macos-feed-presentation:v1`;
  return {
    read: async () =>
      (await db.get<FeedPresentation>(key)) ?? emptyFeedPresentation(),
    update: (change: (state: FeedPresentation) => FeedPresentation) =>
      db.update<FeedPresentation>(key, (old) =>
        change(old ?? emptyFeedPresentation()),
      ),
  };
}
