import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundPost } from "../shared/background";
import type { InspirationItem } from "../shared/inspiration";
import { backgroundClient, type BackgroundClient } from "./background-client";

// Posts the Open Muse service prepared on the account's schedule appear in
// the Feed next to the ones this device generated. They are read-only here:
// likes and discussion links live in this device's own index, which only
// holds posts it generated, so a background post has no like, and Discuss
// opens a new side-chat draft each time instead of a linked conversation.
export const backgroundPostPrefix = "background:";
export const isBackgroundPost = (item: { id: string }) =>
  item.id.startsWith(backgroundPostPrefix);

// One MA reply can carry several posts, so a post is identified by its
// session, event, and title.
const reference = (item: {
  session_id: string;
  event_id: string;
  title: string;
}) => JSON.stringify([item.session_id, item.event_id, item.title]);

export function backgroundFeedItem(post: BackgroundPost): InspirationItem {
  const { id, sequence: _sequence, created_at, ...content } = post;
  return {
    ...content,
    id: `${backgroundPostPrefix}${id}`,
    kind: "feed",
    created_at: new Date(created_at).toISOString(),
    liked: false,
  };
}

// Local items plus background posts not already shown, feed posts newest
// first. A local copy wins, since it carries the like and discussion link.
export function mergeBackgroundFeed(
  items: InspirationItem[],
  posts: BackgroundPost[],
) {
  if (!posts.length) return items;
  const feed = items.filter((item) => item.kind === "feed");
  const seen = new Set(feed.map(reference));
  for (const post of posts) {
    if (!Number.isFinite(post.created_at)) continue;
    const item = backgroundFeedItem(post);
    if (seen.has(reference(item))) continue;
    seen.add(reference(item));
    feed.push(item);
  }
  feed.sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
  );
  return [...feed, ...items.filter((item) => item.kind !== "feed")];
}

// The account's background posts: this device's cached copy at once, then a
// refresh from the service. Only account builds with a signed-in account
// read them; a failure keeps the cached posts and never blocks the page.
// Pass null to read nothing.
export function useBackgroundFeed(
  service: BackgroundClient | null = backgroundClient,
) {
  const [posts, setPosts] = useState<BackgroundPost[]>([]);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (!service?.configured() || !service.accountConnected()) return;
    try {
      const { items } = await service.refresh();
      if (alive.current) setPosts(items);
    } catch {
      /* Offline or unavailable: the cached posts stay. */
    }
  }, [service]);
  useEffect(() => {
    alive.current = true;
    if (!service?.configured()) return;
    void (async () => {
      try {
        if (!service.connected()) await service.restore();
        if (!alive.current || !service.accountConnected()) return;
        const cached = await service.cachedFeed();
        if (alive.current) setPosts(cached.items);
      } catch {
        return;
      }
      await reload();
    })();
    const foreground = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", foreground);
    };
  }, [service, reload]);
  return { posts, reload };
}
