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
  it("carries an icon for every listed app", () => {
    for (const id of appIconIds) expect(appIconSource(id), id).toBeTruthy();
  });
});
