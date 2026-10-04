import { describe, expect, it } from "vitest";
import type { LibraryFile } from "../shared/library";
import { turnOutputs } from "../shared/turn-outputs";
import type { AgentEvent } from "../shared/types";

const at = (minute: number) =>
  `2026-10-03T00:${String(minute).padStart(2, "0")}:00.000Z`;
const ev = (id: string, type: string, minute: number) =>
  ({ id, type, created_at: at(minute) }) as AgentEvent;
const file = (id: string, minute: number): LibraryFile => ({
  id,
  name: `${id}.png`,
  mime_type: "image/png",
  status: "active",
  kind: "image",
  session_id: "s",
  session_title: "Main chat",
  created_at: at(minute),
});

describe("Turn outputs", () => {
  const events = [
    ev("u1", "user.message", 0),
    ev("a1", "agent.message", 1),
    ev("step", "agent.message", 2),
    ev("a2", "agent.message", 5),
    ev("u2", "user.message", 10),
    ev("b1", "agent.message", 11),
  ];
  it("puts files under the last visible reply of the turn that made them", () => {
    const outputs = turnOutputs(
      events,
      [file("late", 12), file("shot2", 4), file("shot1", 3)],
      new Set(["step"]),
    );
    expect(outputs.get("a2")?.map((item) => item.id)).toEqual([
      "shot1",
      "shot2",
    ]);
    expect(outputs.get("b1")?.map((item) => item.id)).toEqual(["late"]);
  });
  it("puts a file under the first reply after it, before a summary", () => {
    const outputs = turnOutputs(
      [
        ev("u1", "user.message", 0),
        ev("onIt", "agent.message", 1),
        ev("hereItIs", "agent.message", 6),
        ev("summary", "agent.message", 7),
      ],
      [file("plan", 5)],
    );
    expect([...outputs.keys()]).toEqual(["hereItIs"]);
  });
  it("never anchors to a folded step, and skips turns without a reply", () => {
    const outputs = turnOutputs(
      [ev("u1", "user.message", 0), ev("step", "agent.message", 2)],
      [file("shot", 3)],
      new Set(["step"]),
    );
    expect(outputs.size).toBe(0);
  });
});
