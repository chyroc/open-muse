import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../shared/types";
import type { Client } from "../src/api";
import { HealthRequestCard } from "../src/HealthRequestCard";
import { UpcomingPanel } from "../src/UpcomingPanel";
import { CheckInSettings } from "../src/CheckInSettings";
import { ConnectorsSheet } from "../src/ConnectorsSheet";
import { LarkConnectSheet } from "../src/LarkConnectSheet";
import { SettingsHome } from "../src/SettingsHome";
import { CompanionAvatar } from "../src/ChatUI";
import { readFileSync } from "node:fs";
import { connectHealth, healthAccess } from "../src/health";
import { t } from "../shared/i18n";

afterEach(() => vi.unstubAllGlobals());

const client = (signedIn: boolean, delivery = false) =>
  ({
    signedIn: () => signedIn,
    upcomingDeliverySupported: () => delivery,
  }) as unknown as Client;
const request = (input: unknown): AgentEvent => ({
  id: "call",
  type: "agent.custom_tool_use",
  name: "health_read",
  input,
});
const steps = request({
  metric: "steps",
  start: new Date(2026, 9, 1).toISOString(),
  end: new Date(2026, 9, 2).toISOString(),
});
const render = (event: AgentEvent) =>
  renderToStaticMarkup(
    <HealthRequestCard
      client={client(true)}
      session="main"
      event={event}
      name="Kit"
      onAnswered={() => {}}
    />,
  );

describe("Apple Health request card", () => {
  it("offers Share only where the iPhone's Health reader exists", () => {
    const elsewhere = render(steps);
    expect(elsewhere).toContain("Share Apple Health data?");
    expect(elsewhere).toContain("Steps · Oct 1");
    expect(elsewhere).toContain("Open Open Muse on your iPhone");
    expect(elsewhere).toContain("Don’t share");
    expect(elsewhere).not.toContain(">Share<");
    vi.stubGlobal("webkit", {
      messageHandlers: { museHealth: { postMessage: vi.fn() } },
    });
    // On the iPhone nothing shows until it knows whether Health is
    // connected: then a connect sheet, or an automatic read.
    expect(render(steps)).toBe("");
  });

  it("lets an invalid request be dismissed without offering to share", () => {
    vi.stubGlobal("webkit", {
      messageHandlers: { museHealth: { postMessage: vi.fn() } },
    });
    const html = render(request({ metric: "steps" }));
    expect(html).toContain("Invalid request");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain(">Share<");
  });
});

describe("Upcoming delivery while closed", () => {
  it("is offered only to accounts the service can deliver for, off until loaded", () => {
    const account = renderToStaticMarkup(
      <UpcomingPanel client={client(true, true)} name="Kit" />,
    );
    expect(account).toContain("Deliver even when Open Muse is closed");
    expect(account).toMatch(/<input type="checkbox" disabled=""/);
    expect(account).toContain("may be billed");
    const local = renderToStaticMarkup(
      <UpcomingPanel client={client(true)} name="Kit" />,
    );
    expect(local).not.toContain("Deliver even when Open Muse is closed");
    expect(local).toContain(
      "This device does not show notifications for reminders.",
    );
  });
});

describe("Signed-out companion settings", () => {
  it("explains Upcoming and hides the check-in toggle", () => {
    const html = renderToStaticMarkup(
      <UpcomingPanel client={client(false)} name="Kit" />,
    );
    expect(html).toContain("Nothing upcoming");
    expect(html).toContain("Connect to MA to keep reminders");
    expect(
      renderToStaticMarkup(<CheckInSettings client={client(false)} />),
    ).toBe("");
  });
});

describe("Connectors", () => {
  it("lists included tools as connected and Lark as available", () => {
    const html = renderToStaticMarkup(
      <ConnectorsSheet
        client={{
          healthConnected: async () => false,
          setHealthConnected: async () => {},
          larkConnected: async () => false,
          forgetLark: async () => {},
          mcdConnection: async () => "unavailable",
          connectMcd: async () => false,
          disconnectMcd: async () => {},
        }}
        onClose={() => {}}
        onDraft={() => {}}
      />,
    );
    expect(html).toContain("Search connectors");
    for (const name of [
      "Web search and pages",
      "Browser",
      "Files and commands",
      "Personal memory",
    ])
      expect(html).toContain(name);
    expect(html).toContain("Connect Lark");
    // Health appears only once the native reader answers.
    expect(html).not.toContain("Apple Health");
    expect(t("Connectors", {}, "zh-CN")).toBe("连接器");
    expect(t("Available", {}, "zh-CN")).toBe("可用");
  });

  it("connects Lark in the app through the service's setup sheet", () => {
    const service = {
      larkConnection: vi.fn(),
      startLarkConnection: vi.fn(),
    };
    const html = renderToStaticMarkup(
      <LarkConnectSheet
        name="Kit"
        service={service}
        onConnected={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Let Kit work in your Lark account");
    expect(html).toContain("Choose the Lark app");
    expect(html).toContain("Approve your access");
    expect(html).toContain("Preparing…");
    // Setup starts only once the sheet is on screen.
    expect(service.startLarkConnection).not.toHaveBeenCalled();
    expect(t("Open Lark to approve", {}, "zh-CN")).toBe("打开飞书授权");
    expect(
      t("Let {name} work in your Lark account", { name: "Kit" }, "zh-CN"),
    ).toBe("让Kit在你的飞书账号中工作");
  });

  it("asks the native Health reader for access status and authorization", async () => {
    expect(await healthAccess()).toBe("unavailable");
    const postMessage = vi.fn(
      async (body: { operation: string }): Promise<unknown> =>
        body.operation === "access" ? "not_requested" : true,
    );
    vi.stubGlobal("webkit", {
      messageHandlers: { museHealth: { postMessage } },
    });
    expect(await healthAccess()).toBe("not_requested");
    await connectHealth();
    expect(postMessage).toHaveBeenLastCalledWith({ operation: "authorize" });
    postMessage.mockResolvedValueOnce("granted");
    await expect(healthAccess()).rejects.toThrow();
  });
});

describe("Companion avatar", () => {
  it("idles only where it is shown alive, and keeps a blink under Reduce Motion", () => {
    expect(renderToStaticMarkup(<CompanionAvatar alive />)).toContain(
      'class="companion-avatar alive"',
    );
    // Swatches and share cards stay still.
    expect(renderToStaticMarkup(<CompanionAvatar />)).toContain(
      'class="companion-avatar"',
    );
    // At work it types instead of idling.
    expect(renderToStaticMarkup(<CompanionAvatar working alive />)).toContain(
      'class="companion-avatar working alive"',
    );
    const css = readFileSync("src/chat.css", "utf8");
    // The plush body is a rendered image the face sits on.
    expect(css).toContain('url("./assets/companion/plush.png")');
    expect(
      readFileSync("src/assets/companion/plush.png").length,
    ).toBeGreaterThan(10_000);
    expect(css).toMatch(
      /\.companion-avatar\.alive:not\(\.working\) \.companion-face i \{\s*animation-name: companion-idle-blink;/,
    );
  });
});

describe("Settings home", () => {
  it("shows a status card and one list of sections when signed in", () => {
    const html = renderToStaticMarkup(
      <SettingsHome
        client={client(true)}
        onConnection={() => {}}
        onDraft={() => {}}
      />,
    );
    expect(html).toContain("Volcano Ark MA");
    for (const label of [
      "Connectors",
      "Devices",
      "Message channels",
      "Check-ins",
      "Account and workspace",
      "About",
    ])
      expect(html).toContain(label);
    // Studio is not listed in Settings.
    expect(html).not.toContain("MA Studio");
    // The page ends with the account and signing out of it, in that order;
    // resetting the device moved into the account's sheet.
    expect(html.indexOf("Your account")).toBeGreaterThan(html.indexOf("About"));
    expect(html.indexOf("Sign out")).toBeGreaterThan(
      html.indexOf("Your account"),
    );
    expect(html).not.toContain("Reset this device");
    // Permissions come before message channels.
    expect(html.indexOf("Permissions")).toBeLessThan(
      html.indexOf("Message channels"),
    );
    expect(html).toContain("Language");
    expect(html).toContain("Follow system");
    expect(t("Follow system", {}, "zh-CN")).toBe("跟随系统");
    // Account details open in their own sheet instead of filling the page.
    expect(html).not.toContain("settings-card auth-card");
    expect(t("Account and workspace", {}, "zh-CN")).toBe("账号与工作区");
  });
});
