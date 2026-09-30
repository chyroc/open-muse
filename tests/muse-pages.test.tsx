import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChatWelcome,
  FeedPage,
  IdeasPage,
  primaryNavigation,
  goalPrompt,
} from "../src/MusePages";

describe("Muse iOS navigation and real status", () => {
  it("the planning request includes the goal description, existing steps, and completion status", () => {
    const prompt = goalPrompt({
      id: "goal",
      title: "Weekend trip",
      description: "Budget: 1000 CNY",
      status: "active",
      created_at: "",
      updated_at: "",
      steps: [
        { id: "one", title: "Choose dates", done: true },
        { id: "two", title: "Pick trains", done: false },
      ],
    });
    expect(prompt).toContain("Budget: 1000 CNY");
    expect(prompt).toContain("- [x] Choose dates");
    expect(prompt).toContain("- [ ] Pick trains");
    expect(prompt).toContain("ask for approval first");
  });
  it("keeps the five entries confirmed in the static bundle", () => {
    expect(primaryNavigation.map((item) => item.id)).toEqual([
      "home",
      "feed",
      "discover",
      "goals",
      "library",
    ]);
    expect(new Set(primaryNavigation.map((item) => item.path)).size).toBe(5);
  });
  it("the dynamic empty state shows no fabricated results", () => {
    const html = renderToStaticMarkup(
      <FeedPage sessions={[]} loading={false} />,
    );
    expect(html).toContain("No new activity yet");
    expect(html).toContain(
      "Scheduled pushes and proactive recommendations are not available",
    );
  });
  it("dynamically shows real session links and running status", () => {
    const html = renderToStaticMarkup(
      <FeedPage
        sessions={[
          {
            id: "my-session",
            title: "Test",
            status: "running",
            category: "general",
            created_at: "2026-09-29",
            updated_at: "2026-09-29",
          },
        ]}
        loading={false}
      />,
    );
    expect(html).toContain("#/task/my-session");
    expect(html).toContain("Processing");
  });
  it("preset ideas never masquerade as personalized recommendations", () => {
    expect(renderToStaticMarkup(<IdeasPage onTemplate={() => {}} />)).toContain(
      "These are preset suggestions",
    );
  });
  it("the chat input and its linked goal are visible", () => {
    const html = renderToStaticMarkup(
      <ChatWelcome
        composer={<textarea aria-label="Describe your task" />}
        sessions={[]}
        onTemplate={() => {}}
        onClearGoal={() => {}}
        goal={{
          id: "goal",
          title: "Weekend plan",
          description: "",
          steps: [],
          status: "active",
          created_at: "",
          updated_at: "",
        }}
      />,
    );
    expect(html).toContain("Weekend plan");
    expect(html).toContain("Unlink goal");
    expect(html).toContain("Describe your task");
  });
});
