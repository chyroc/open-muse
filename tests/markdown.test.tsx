import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components";

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
