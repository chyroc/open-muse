import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownManager } from "@tiptap/markdown";
import { defaultIdentity } from "../../src/direct/identity";
import { IdentityCards, StatusPanel, fileDate } from "../ui/StatusPanel";
import { editorExtensions, sourceOnly } from "../ui/markdown";

describe("Mac identity workspace", () => {
  it("matches the four observed desktop status tabs, not the mobile sheet", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <StatusPanel
        identity={defaultIdentity()}
        status="Not connected"
        tab="identity"
        onTab={noop}
        onClose={noop}
        events={[]}
        approvals={[]}
        busy={false}
        onConfirm={noop}
        onDocument={noop}
      />,
    );
    for (const label of ["Activity", "Approvals", "Upcoming", "Identity"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain("Recent");
    expect(html).toContain('aria-labelledby="status-identity"');
  });
  it("shows exact document targets, card dates and access notices", () => {
    const identity = defaultIdentity();
    identity.documents["SOUL.md"].updated_at = "2026-09-30T12:00:00Z";
    const html = renderToStaticMarkup(
      <IdentityCards identity={identity} onOpen={() => {}} disabled={false} />,
    );
    expect(html).toContain('aria-label="Open SOUL.md"');
    expect(html).toContain('aria-label="Open MEMORY.md"');
    expect(html).toContain("09.30.26");
    expect(html.match(/ACCESS WITH CARE/g)).toHaveLength(2);
    expect(fileDate("invalid")).toBe("");
    expect(fileDate()).toBe("");
  });
  it("round-trips supported headings, emphasis, lists, links and tables", () => {
    const markdown = new MarkdownManager({ extensions: editorExtensions() });
    const text =
      "# Memory\n\n**Important** and *thoughtful*.\n\n- Keep this fact\n- Keep this [source](https://example.com)\n\n| Item | Value |\n| --- | --- |\n| Color | Copper |";
    const result = markdown.serialize(markdown.parse(text));
    for (const content of [
      "# Memory",
      "**Important**",
      "*thoughtful*",
      "Keep this fact",
      "https://example.com",
      "Copper",
    ])
      expect(result).toContain(content);
    expect(markdown.serialize(markdown.parse(result))).toBe(result);
  });
  it("keeps unsupported documents in lossless source mode", () => {
    for (const content of [
      "![image](photo.png)",
      "- [x] Done",
      "<details>\nA note</details>",
      "[link]: https://example.com",
    ])
      expect(sourceOnly(content, "MEMORY.md")).toBe(true);
    expect(sourceOnly('{"name":"Muse"}', "IDENTITY.md")).toBe(true);
    expect(sourceOnly("# SOUL.md\n\nBe considerate.", "SOUL.md")).toBe(false);
  });
});
