import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInspiration } from "../shared/inspiration";
import { PostChart } from "../src/PostChart";
import { LocalDatabase } from "../src/direct/storage";
import { feedAdapter } from "../src/direct/account-sync";
import { uuid } from "../shared/crypto";

const post = {
  title: "Sony's new earbuds",
  body: "The new model cancels noise 25% better.",
  emoji: "🎧",
  reason: "You compared earbuds last week.",
  category: "Tech",
  prompt: "Compare them for me",
  sources: [],
  images: [],
};
const chart = {
  title: "Average noise reduction",
  unit: "%",
  items: [
    { label: "AirPods Pro 3", value: 90 },
    { label: "WF-1000XM6", value: 88 },
  ],
  note: "XM6 cancels 25% more than XM5",
};

describe("Charts in Feed posts", () => {
  it("keeps a well-formed chart and drops a malformed one with the post kept", () => {
    expect(
      parseInspiration(JSON.stringify({ items: [{ ...post, chart }] }))[0]
        .chart,
    ).toEqual(chart);
    const [kept] = parseInspiration(
      JSON.stringify({
        items: [
          {
            ...post,
            chart: { title: "One bar", items: [{ label: "a", value: 1 }] },
          },
        ],
      }),
    );
    expect(kept.title).toBe(post.title);
    expect(kept.chart).toBeUndefined();
  });

  it("draws labelled bars, the largest in ink, against a full bar for %", () => {
    const html = renderToStaticMarkup(<PostChart chart={chart} />);
    expect(html).toContain("Average noise reduction");
    expect(html).toContain("<strong>90%</strong>");
    expect(html).toContain('class="lead" style="width:90%"');
    expect(html).toContain('style="width:88%"');
    expect(html).toContain("XM6 cancels 25% more than XM5");
  });
});

describe("A post's chart across devices", () => {
  it("stays on this device and survives the account's copy coming back", async () => {
    const db = new LocalDatabase(`chart-${uuid()}`);
    const storage = "acct:inspiration:v1";
    const item = {
      ...post,
      id: "post-1",
      kind: "feed",
      session_id: "sesn-1",
      event_id: "evt-1",
      created_at: "2026-10-05T00:00:00Z",
      liked: false,
      chart,
    };
    await db.set(storage, {
      items: [item],
      runs: {},
      instructionsDismissed: false,
    });
    const adapter = feedAdapter(db, "acct");
    const sent = (await adapter.snapshot()).values.get("post-1") as Record<
      string,
      unknown
    >;
    expect(sent.title).toBe(post.title);
    expect(sent).not.toHaveProperty("chart");
    // The account's copy, liked on another device, replaces the local one.
    await adapter.update("post-1", (value) => ({
      ...(value as object),
      liked: true,
    }));
    const [stored] = (await db.get<{
      items: Array<{ liked: boolean; chart?: unknown }>;
    }>(storage))!.items;
    expect(stored.liked).toBe(true);
    expect(stored.chart).toEqual(chart);
  });
});
