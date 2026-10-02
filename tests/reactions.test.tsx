import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emojiCategories, quickReactions } from "../shared/emoji";
import { t } from "../shared/i18n";
import { zhCN } from "../shared/locales/zh-CN";
import { MessageBubble } from "../src/ChatUI";
import { EmojiPicker } from "../src/EmojiPicker";

describe("Message reactions", () => {
  it("offers each emoji once, including every quick reaction", () => {
    const all = emojiCategories.flatMap((category) =>
      category.emoji.map(([emoji]) => emoji),
    );
    expect(new Set(all).size).toBe(all.length);
    for (const emoji of quickReactions) expect(all).toContain(emoji);
    expect(quickReactions).toHaveLength(8);
  });

  it("names every category and emoji in both languages", () => {
    const names = emojiCategories.flatMap((category) => [
      category.label,
      ...category.emoji.map(([, name]) => name),
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[\x20-\x7e]+$/);
      expect(Object.hasOwn(zhCN, name)).toBe(true);
    }
    expect(t("thumbs up", {}, "zh-CN")).toBe("赞");
    expect(t("Smileys & Emotion", {}, "en")).toBe("Smileys & Emotion");
  });

  it("shows a reaction on the bubble with an accessible label", () => {
    const html = renderToStaticMarkup(
      <MessageBubble label="Options" onOptions={() => {}} reaction="🔥">
        Hello
      </MessageBubble>,
    );
    expect(html).toContain('class="chat-bubble reacted"');
    expect(html).toContain('class="bubble-reaction"');
    expect(html).toContain(
      `aria-label="${t("Reaction: {emoji}", { emoji: "🔥" })}"`,
    );
    const plain = renderToStaticMarkup(
      <MessageBubble label="Options" onOptions={() => {}}>
        Hello
      </MessageBubble>,
    );
    expect(plain).not.toContain("bubble-reaction");
  });

  it("lays out the picker with search, shortcuts and a section per category", () => {
    const html = renderToStaticMarkup(
      <EmojiPicker selected="👍" onPick={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain(`aria-label="${t("Search emoji")}"`);
    expect(html.match(/class="emoji-section"/g)).toHaveLength(
      emojiCategories.length,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});
