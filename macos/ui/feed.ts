import { formatLocale, t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import type { InspirationItem } from "../../shared/inspiration";
import { LocalDatabase } from "../../src/direct/storage";
import { macOwner } from "./owner";

// `order` is kept for records written by earlier versions; posts are shown
// newest first.
export type FeedPresentation = {
  hidden: string[];
  order: Record<string, string[]>;
};
export const emptyFeedPresentation = (): FeedPresentation => ({
  hidden: [],
  order: {},
});
const presentationDatabase = new LocalDatabase();
const timeOf = (item: InspirationItem) => Date.parse(item.created_at) || 0;

// The posts shown on the page, newest first, without the ones removed on this
// Mac. Ideas and other kinds stay on their own pages.
export function feedPosts(
  items: InspirationItem[],
  presentation: FeedPresentation,
) {
  return items
    .filter(
      (item) => item.kind === "feed" && !presentation.hidden.includes(item.id),
    )
    .sort((a, b) => timeOf(b) - timeOf(a));
}

// "just now", "5m ago", "9h ago", "4d ago", then a short date.
export function postAge(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count}m ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count}h ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{count}d ago", { count: days });
  return new Date(at).toLocaleDateString(formatLocale(), {
    month: "short",
    day: "numeric",
  });
}

// The full moment a post was written, for the top of its options menu. The
// year appears only when it is not the current one.
export function postMoment(at: number, now = Date.now()) {
  const date = new Date(at);
  const locale = formatLocale();
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return t("{date} at {time}", {
    date: date.toLocaleDateString(locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
    time: date.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    }),
  });
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
