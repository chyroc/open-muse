import { describe, expect, it } from "vitest";
import {
  canGroup,
  groupLinks,
  timeMarkerLabel,
  timeMarkers,
} from "../ui/messageGroups";

const at = (seconds: number) =>
  new Date(1_700_000_000_000 + seconds * 1000).toISOString();

describe("message groups", () => {
  it("joins bubbles from one side sent within two minutes", () => {
    expect(
      canGroup({ side: "agent", at: at(0) }, { side: "agent", at: at(119) }),
    ).toBe(true);
    expect(
      canGroup({ side: "agent", at: at(0) }, { side: "agent", at: at(120) }),
    ).toBe(false);
    expect(
      canGroup({ side: "agent", at: at(0) }, { side: "user", at: at(1) }),
    ).toBe(false);
    expect(
      canGroup({ side: "user", at: at(5) }, { side: "user", at: at(1) }),
    ).toBe(false);
    expect(canGroup({ side: "user" }, { side: "user", at: at(1) })).toBe(false);
  });
  it("keeps a bubble with a reaction on its own", () => {
    expect(
      canGroup(
        { side: "agent", at: at(0), reacted: true },
        { side: "agent", at: at(1) },
      ),
    ).toBe(false);
  });
  it("marks which neighbours each bubble shares corners with", () => {
    expect(
      groupLinks([
        { side: "agent", at: at(0) },
        { side: "agent", at: at(1) },
        { side: "agent", at: at(2) },
        { side: "user", at: at(3) },
      ]),
    ).toEqual([
      { prev: false, next: true },
      { prev: true, next: true },
      { prev: true, next: false },
      { prev: false, next: false },
    ]);
  });
});

describe("time markers", () => {
  it("marks the first message, a new day and gaps over half an hour", () => {
    const at = (day: number, hour: number, minute: number) =>
      new Date(2026, 9, day, hour, minute).toISOString();
    expect(
      timeMarkers([
        at(2, 10, 0),
        at(2, 10, 20),
        at(2, 10, 51),
        undefined,
        at(2, 11, 0),
        at(3, 0, 5),
      ]),
    ).toEqual([true, false, true, false, false, true]);
  });
  it("adds the date only away from today and the year only in another year", () => {
    const now = new Date(2026, 9, 4, 12).getTime();
    const label = (value: Date) =>
      timeMarkerLabel(value.toISOString(), "en-US", now);
    expect(label(new Date(2026, 9, 4, 10, 19))).toBe("10:19 AM");
    expect(label(new Date(2026, 9, 2, 10, 18))).toBe("Oct 2, 10:18 AM");
    expect(label(new Date(2025, 11, 31, 9, 5))).toBe("Dec 31, 2025, 9:05 AM");
    expect(
      timeMarkerLabel(new Date(2026, 9, 2, 10, 18).toISOString(), "zh-CN", now),
    ).toBe("10月2日 10:18");
  });
});
