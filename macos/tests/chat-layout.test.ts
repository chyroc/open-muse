import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Mac chat layout", () => {
  it("keeps size containers and container units out of the conversation", () => {
    // A size container anywhere around the messages leaves WebKit's scroll
    // range behind, and the newest messages cannot be scrolled to.
    const css = readFileSync("macos/ui/desktop.css", "utf8");
    expect(css).not.toMatch(/container-type/);
    expect(css).not.toMatch(/\d(cqi|cqw|cqh|cqb|cqmin|cqmax)\b/);
    expect(css).toContain("grid-template-columns: fit-content(85%) auto;");
  });
});
