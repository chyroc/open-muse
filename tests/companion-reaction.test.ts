import { describe, expect, it } from "vitest";
import { companionReaction, eventText, type AgentEvent } from "../shared/types";
import { toolingInstructions } from "../shared/tooling";

const reply = (text: string, type = "agent.message") =>
  ({ id: "e", type, content: [{ type: "text", text }] }) as AgentEvent;

describe("The companion's reaction to a message", () => {
  it("reads a reply's opening mark as an emoji and hides it from the text", () => {
    const event = reply("[[react:👍]] 好，我在帮你做了。");
    expect(companionReaction(event)).toBe("👍");
    expect(eventText(event)).toBe("好，我在帮你做了。");
    // A reply that is only a reaction has no text to show.
    expect(eventText(reply("[[react:❤️]]"))).toBe("");
    expect(companionReaction(reply("[[react:❤️]]"))).toBe("❤️");
  });

  it("ignores marks that are not an emoji, are not first, or are the person's", () => {
    expect(companionReaction(reply("[[react:ok]] fine"))).toBeUndefined();
    expect(companionReaction(reply("Sure [[react:👍]]"))).toBeUndefined();
    expect(eventText(reply("Sure [[react:👍]]"))).toBe("Sure [[react:👍]]");
    const mine = reply("[[react:👍]] hi", "user.message");
    expect(companionReaction(mine)).toBeUndefined();
    expect(eventText(mine)).toBe("[[react:👍]] hi");
  });

  it("is offered to the companion, at most once a turn", () => {
    expect(toolingInstructions).toContain("[[react:👍]]");
    expect(toolingInstructions).toContain("at most once a turn");
  });
});
