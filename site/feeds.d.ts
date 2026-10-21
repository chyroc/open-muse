// Types for site/feeds.js, for the tests that call it.
export function updateFeeds(
  downloads: Record<string, Record<string, unknown>>,
  mirror: { base: string },
): Record<string, Record<string, unknown>>;
