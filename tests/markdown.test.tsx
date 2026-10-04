import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components";
import { highlightCode } from "../src/highlight";

describe("Replies in Markdown", () => {
  it("breaks lines written as <br> in table cells", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={
          "| Item | iPhone |\n| --- | --- |\n| Chip | A19 Pro<br>6-core CPU<br/>12 GB |"
        }
      />,
    );
    expect(html).toMatch(/A19 Pro<br\/>\s*6-core CPU<br\/>\s*12 GB/);
    expect(html).not.toContain("&lt;br");
  });

  it("still shows any other HTML as text, never as markup", () => {
    const html = renderToStaticMarkup(
      <Markdown text={'Hi <img src="x" onerror="alert(1)"> <b>bold</b>'} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });
});

describe("Code in replies", () => {
  it("shows a fenced block with its language, a copy button and no wrap", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={
          "```python\ndef is_palindrome(s):\n    return s == s[::-1]  # same\n```"
        }
      />,
    );
    expect(html).toContain('class="code-block"');
    expect(html).toContain("<span>python</span>");
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('<span class="code-keyword">def</span>');
    expect(html).toContain('<span class="code-call">is_palindrome</span>');
    expect(html).toContain('<span class="code-comment"># same</span>');
  });

  it("highlights only by splitting text, never by inserting markup", () => {
    const tokens = highlightCode('x = "<b>hi</b>" // note', "js");
    expect(tokens.map((token) => token.text).join("")).toBe(
      'x = "<b>hi</b>" // note',
    );
    expect(tokens.find((token) => token.kind === "string")?.text).toBe(
      '"<b>hi</b>"',
    );
    expect(tokens.at(-1)).toEqual({ text: "// note", kind: "comment" });
    // In Python, // is division and # starts a comment.
    expect(
      highlightCode("a // b # half", "python").find(
        (token) => token.kind === "comment",
      )?.text,
    ).toBe("# half");
  });

  it("keeps inline code as it was", () => {
    const html = renderToStaticMarkup(<Markdown text={"Use `cleaned` here"} />);
    expect(html).toContain("<code>cleaned</code>");
    expect(html).not.toContain("code-block");
  });
});
