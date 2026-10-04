import { renderToStaticMarkup } from "react-dom/server";
import { Search } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  AppIcon,
  ConnectorIcon,
  appIconIds,
  hasAppIcon,
} from "../src/AppIcons";

describe("connector app icons", () => {
  it("draws the app a connector stands for and keeps a glyph otherwise", () => {
    const lark = renderToStaticMarkup(
      <ConnectorIcon id="lark" Icon={Search} />,
    );
    expect(lark).toContain('class="connector-icon app-icon"');
    expect(lark).toContain("#3370ff");
    const web = renderToStaticMarkup(<ConnectorIcon id="web" Icon={Search} />);
    expect(web).not.toContain("app-icon");
    expect(web).toContain("lucide-search");
    expect(hasAppIcon("memory")).toBe(false);
  });
  it("draws every listed app on its own tile", () => {
    for (const id of appIconIds) {
      const markup = renderToStaticMarkup(<AppIcon id={id} />);
      expect(markup, id).toMatch(/^<svg viewBox="0 0 40 40"/);
      expect(markup, id).toContain('<rect width="40" height="40" rx="9"');
    }
  });
  it("shows today's date on the calendar", () => {
    expect(renderToStaticMarkup(<AppIcon id="calendar" />)).toContain(
      `>${new Date().getDate()}</text>`,
    );
  });
});
