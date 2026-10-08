import { describe, expect, it } from "vitest";
import { mergeHistoryWindow, type AgentEvent } from "../shared/types";

const event = (id: string, at: string): AgentEvent => ({
  id,
  type: "agent.message",
  processed_at: `2026-10-08T10:00:${at}Z`,
});

describe("Latest-part history reads", () => {
  it("replace only the span they cover and keep earlier history", () => {
    const earlier = event("earlier", "01");
    const shown = event("shown", "05");
    const removed = event("removed", "06");
    const before = [earlier, shown, removed];
    // A live event that arrived while the read was in flight stays too.
    const live = event("live", "09");
    const current = [...before, live];
    const merged = mergeHistoryWindow(before, current, [
      { ...shown, annotation: "from history" } as AgentEvent,
      event("new", "08"),
    ]);
    expect(merged.map((e) => e.id)).toEqual([
      "earlier",
      "shown",
      "new",
      "live",
    ]);
    expect((merged[1] as { annotation?: string }).annotation).toBe(
      "from history",
    );
    expect(mergeHistoryWindow(before, current, [])).toBe(current);
  });
});
