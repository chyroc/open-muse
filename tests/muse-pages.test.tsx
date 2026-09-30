import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWelcome, primaryNavigation } from "../src/MusePages";
import { goalPrompt } from "../shared/goals";
import {
  InspirationPage,
  InspirationPost,
  InspirationIdea,
} from "../src/InspirationPages";
import { Client } from "../src/api";
import type { InspirationItem } from "../shared/inspiration";

const post: InspirationItem = {
  id: "post",
  kind: "feed",
  title: "An idea for your weekend",
  body: "Compare two nearby trails.",
  emoji: "🌿",
  category: "Outdoors",
  reason: "You mentioned walking.",
  prompt: "Help compare these trails.",
  sources: [{ title: "Trail map", url: "https://example.com/map" }],
  session_id: "generation",
  event_id: "answer",
  created_at: "2026-09-30T00:00:00Z",
  liked: true,
};

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
      <InspirationPage
        client={new Client()}
        kind="feed"
        onDiscuss={() => {}}
      />,
    );
    expect(html).toContain("Background delivery is not enabled");
    expect(html).not.toContain("inspiration-post");
    expect(html).toContain('disabled=""');
  });
  it("shows source links, like state, discussion and post information", () => {
    const html = renderToStaticMarkup(
      <InspirationPost
        item={post}
        onLike={() => {}}
        onDiscuss={() => {}}
        busy={false}
      />,
    );
    expect(html).toContain('href="https://example.com/map"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Discuss");
    expect(html).toContain('aria-label="Post information"');
  });
  it("ideas display generated content, not fixed template tiles", () => {
    const html = renderToStaticMarkup(
      <InspirationIdea item={post} onOpen={() => {}} />,
    );
    expect(html).toContain(post.title);
    expect(html).toContain(post.body);
    expect(html).not.toContain("idea-symbol");
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
