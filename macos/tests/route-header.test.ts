import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { routeCollapse, routeHeader } from "../ui/routeHeader";

describe("large page titles", () => {
  it("collapse over the first stretch of scrolling and then hold", () => {
    expect(routeCollapse(-20)).toBe(0);
    expect(routeCollapse(0)).toBe(0);
    expect(routeCollapse(routeHeader.range / 2)).toBe(0.5);
    expect(routeCollapse(routeHeader.range)).toBe(1);
    expect(routeCollapse(900)).toBe(1);
  });
  it("is shared by the feed, ideas and goals pages", () => {
    for (const page of ["FeedPage", "IdeasPage", "GoalsPage"]) {
      const source = readFileSync(`macos/ui/${page}.tsx`, "utf8");
      expect(source, page).toContain("route-scroller");
      expect(source, page).toContain("route-heading");
      expect(source, page).toContain("ref={routeScroller}");
    }
  });
});
