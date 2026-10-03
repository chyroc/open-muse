import { describe, expect, it } from "vitest";
import { eventsToKeep } from "../shared/event-cache";
import type { AgentEvent } from "../shared/types";

const event = (id: string, type: string) => ({ id, type }) as AgentEvent;

describe("event cache", () => {
  it("keeps the chat's messages even after many tool steps", () => {
    const events = [
      event("u1", "user.message"),
      event("a1", "agent.message"),
      ...Array.from({ length: 500 }, (_, i) =>
        event(`t${i}`, "agent.tool_use"),
      ),
      event("u2", "user.message"),
    ];
    const kept = eventsToKeep(events);
    expect(kept.map((e) => e.id).filter((id) => !id.startsWith("t"))).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
    expect(kept.filter((e) => e.type === "agent.tool_use")).toHaveLength(200);
    // The newest tool steps, in their original order.
    expect(kept.at(-2)?.id).toBe("t499");
    expect(kept.indexOf(events[0])).toBe(0);
  });
  it("caps the messages at the latest 300", () => {
    const events = Array.from({ length: 350 }, (_, i) =>
      event(`m${i}`, i % 2 ? "agent.message" : "user.message"),
    );
    const kept = eventsToKeep(events);
    expect(kept).toHaveLength(300);
    expect(kept[0].id).toBe("m50");
  });
});
