import { describe, expect, it } from "vitest";
import { canGroup, groupLinks } from "../ui/messageGroups";

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
