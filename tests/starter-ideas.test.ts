import { describe, expect, it } from "vitest";
import { defaultFeedInstructions } from "../shared/inspiration";
import { t } from "../shared/i18n";
import { starterIdeaPrefix, starterIdeas } from "../shared/starter-ideas";

describe("starter ideas", () => {
  it("offers translated ideas that are not saved items", () => {
    const ideas = starterIdeas((text) => t(text, {}, "zh-CN"));
    expect(ideas).toHaveLength(8);
    for (const idea of ideas) {
      expect(idea.id.startsWith(starterIdeaPrefix)).toBe(true);
      expect(idea.kind).toBe("ideas");
      expect(idea.emoji).toBeTruthy();
      // Every line has a Simplified Chinese translation.
      for (const text of [idea.title, idea.body, idea.prompt, idea.reason])
        expect(text).toMatch(/[一-鿿]/);
    }
    expect(new Set(ideas.map((idea) => idea.id)).size).toBe(8);
  });

  it("shows the default feed instructions in the person's language", () => {
    expect(t(defaultFeedInstructions, {}, "zh-CN")).toContain("动态");
    expect(t(defaultFeedInstructions, {}, "en")).toBe(defaultFeedInstructions);
  });
});
