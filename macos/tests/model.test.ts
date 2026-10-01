import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Rail } from "../ui/Chrome";
import {
  activityEvents,
  chatMessages,
  parseRoute,
  shouldSendOnKey,
  sideChats,
} from "../ui/model";
import type { Session } from "../../shared/types";

describe("Mac workspace navigation", () => {
  it("renders MA agent replies and tools using the actual protocol event names", () => {
    const events = [
      {
        id: "u",
        type: "user.message",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        id: "a",
        type: "agent.message",
        content: [{ type: "text", text: "Hi" }],
      },
      { id: "t", type: "agent.tool_use", name: "memory_read" },
      { id: "s", type: "session.status_idle" },
      { id: "empty", type: "agent.message", content: [] },
    ];
    expect(chatMessages(events).map((event) => event.id)).toEqual(["u", "a"]);
    expect(activityEvents(events).map((event) => event.id)).toEqual(["t"]);
  });
  it("keeps desktop routes independent from mobile routes", () => {
    expect(parseRoute("#/new")).toEqual({ page: "chat", newSide: true });
    expect(parseRoute("#/chat/s-123")).toEqual({
      page: "chat",
      conversation: "s-123",
    });
    expect(parseRoute("#/ideas")).toEqual({ page: "ideas" });
    expect(parseRoute("#/goals/goal-123")).toEqual({
      page: "goals",
      goal: "goal-123",
    });
    expect(parseRoute("#/goals/../../private")).toEqual({ page: "chat" });
    expect(parseRoute("#/chat/../../secrets")).toEqual({ page: "chat" });
  });
  it("sends on Return, preserving Shift-Return and IME composition", () => {
    expect(
      shouldSendOnKey({ key: "Enter", shiftKey: false, isComposing: false }),
    ).toBe(true);
    expect(
      shouldSendOnKey({ key: "Enter", shiftKey: true, isComposing: false }),
    ).toBe(false);
    expect(
      shouldSendOnKey({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
  });
  it("excludes main, continued and archived chats from the active drawer", () => {
    const sessions = ["main", "old", "side", "archived"].map((id) => ({
      id,
      title: id,
    })) as Session[];
    const index = {
      mainId: "main",
      entries: {
        old: {
          title: "Old",
          kind: "main" as const,
          archived: false,
          continuedBy: "main",
        },
        side: {
          title: "Weekend plans",
          kind: "side" as const,
          archived: false,
        },
        archived: { title: "Archived", kind: "side" as const, archived: true },
      },
    };
    expect(sideChats(sessions, index, "WEEKEND").map((s) => s.id)).toEqual([
      "side",
    ]);
    expect(sideChats(sessions, index, "", true).map((s) => s.id)).toEqual([
      "archived",
    ]);
  });
  it("exposes the observed six-item rail and native menu shortcuts", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(Rail, {
        page: "chat",
        onNavigate: noop,
        onSearch: noop,
        onSettings: noop,
        onShortcuts: noop,
      }),
    );
    for (const label of [
      "Chat",
      "Search",
      "Feed",
      "Ideas",
      "Goals",
      "Library",
      "Settings",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-current="page"');
  });
});
