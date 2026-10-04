import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "../shared/i18n";
import type { Client } from "../src/api";
import { BrowserTasks, BrowserViewer } from "../src/BrowserViewer";

const client = {} as Client;
const noop = () => {};

describe("cloud browser task", () => {
  it("says the browser is starting until its first picture arrives", () => {
    const html = renderToStaticMarkup(
      <BrowserTasks
        client={client}
        view="starting"
        paused={false}
        onReady={noop}
        onOpen={noop}
        onNew={noop}
        onEnded={noop}
      />,
    );
    expect(html).toContain(`>${t("1 browser task")}</h3>`);
    expect(html).toContain(t("Starting the browser…"));
    // No fresh browser while one is still starting; the row waits too.
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain(t("New browser session"));
    expect(html).toMatch(/class="browser-task" disabled=""/);
  });
});

describe("cloud browser", () => {
  const render = (initialMode: "control" | "watch") =>
    renderToStaticMarkup(
      <BrowserViewer
        client={client}
        view="view-1"
        unavailable={false}
        initialMode={initialMode}
        onClose={noop}
        onStopped={noop}
      />,
    );
  it("hands the page to the person with the tools to steer it", () => {
    const html = render("control");
    expect(html).toContain(`>${t("You’re in control")}</h2>`);
    expect(html).toContain(`aria-label="${t("Done controlling the browser")}"`);
    for (const label of [
      "Stop task",
      "Keyboard",
      "Pan and zoom",
      "Copy",
      "Paste",
    ])
      expect(html).toContain(`aria-label="${t(label)}"`);
    // Pan and zoom is on from the start.
    expect(html).toMatch(
      new RegExp(`aria-label="${t("Pan and zoom")}" aria-pressed="true"`),
    );
    expect(html).not.toContain(t("Control the browser"));
  });
  it("shows the browser to watch, with control and stop one tap away", () => {
    const html = render("watch");
    expect(html).toContain(`>${t("You can control the browser")}</h2>`);
    expect(html).toContain(`>${t("Controlled by you")}</p>`);
    expect(html).toContain(`aria-label="${t("Close")}"`);
    expect(html).toContain(`>${t("Control the browser")}</button>`);
    expect(html).toContain(`>${t("Stop task")}</button>`);
    expect(html).not.toContain(`aria-label="${t("Keyboard")}"`);
  });
});
