import { renderToStaticMarkup } from "react-dom/server";
import { Search } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  ConnectorIcon,
  appIconIds,
  appIconSource,
  hasAppIcon,
} from "../src/AppIcons";

describe("connector app icons", () => {
  it("shows the official icon of the app a connector stands for", () => {
    const lark = renderToStaticMarkup(
      <ConnectorIcon id="lark" Icon={Search} />,
    );
    expect(lark).toContain('class="connector-icon app-icon"');
    expect(lark).toContain(`src="${appIconSource("lark")}"`);
    const web = renderToStaticMarkup(<ConnectorIcon id="web" Icon={Search} />);
    expect(web).not.toContain("app-icon");
    expect(web).toContain("lucide-search");
    expect(hasAppIcon("memory")).toBe(false);
  });
  it("uses a bundled image when present and falls back to the glyph otherwise", () => {
    for (const id of appIconIds)
      expect(hasAppIcon(id), id).toBe(Boolean(appIconSource(id)));
    // A reserved slot whose image is not bundled yet shows the connector glyph
    // instead of a broken image.
    if (!hasAppIcon("mcd")) {
      const mcd = renderToStaticMarkup(
        <ConnectorIcon id="mcd" Icon={Search} />,
      );
      expect(mcd).not.toContain("app-icon");
      expect(mcd).toContain("lucide-search");
    }
  });
});
