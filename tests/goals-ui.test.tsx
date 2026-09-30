import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalCategories, GoalRow, GoalsPage } from "../src/GoalsPage";
import { Client } from "../src/api";

describe("iOS goal navigation", () => {
  it("provides seven conversation-led categories without an instant-create form", () => {
    const html = renderToStaticMarkup(<GoalCategories onChoose={() => {}} />);
    for (const label of [
      "Health",
      "Relationships",
      "Finance",
      "Career",
      "Interests",
      "Productivity",
      "Something else",
    ])
      expect(html).toContain(label);
    expect(html.match(/<button/g)).toHaveLength(7);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("task status");
  });
  it("keeps empty tracking separate from category entry and exposes actual loading", () => {
    const html = renderToStaticMarkup(
      <GoalsPage
        client={new Client()}
        onStart={() => {}}
        onCategory={() => {}}
        optionsOpen={false}
        onOptionsClose={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Tracking"');
    expect(html).toContain("Loading goals");
    expect(html).toContain('aria-label="Create a goal"');
    expect(html).not.toContain("In progress");
    expect(html).not.toContain("New step");
  });
  it("supports subtitle visibility while keeping the goal accessible", () => {
    const goal = {
      id: "one",
      title: "Read a chapter",
      description: "After lunch",
      status: "active" as const,
      steps: [],
      created_at: "",
      updated_at: "",
    };
    const shown = renderToStaticMarkup(
      <GoalRow goal={goal} subtitle onOpen={() => {}} />,
    );
    const hidden = renderToStaticMarkup(
      <GoalRow goal={goal} subtitle={false} onOpen={() => {}} />,
    );
    expect(shown).toContain("After lunch");
    expect(hidden).not.toContain("After lunch");
    expect(hidden).toContain('aria-label="Open goal: Read a chapter"');
  });
});
