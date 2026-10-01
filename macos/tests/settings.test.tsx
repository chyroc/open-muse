import "fake-indexeddb/auto";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  activeLanguage,
  appVersion,
  isSettingsRoute,
  openNativeSettings,
  settingsPath,
  settingsRouteSection,
  settingsSections,
} from "../ui/settings";
import { SettingsWindow } from "../ui/SettingsWindow";
import { restoreInBackground } from "../ui/startup";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  location.hash = "";
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
  vi.unstubAllGlobals();
});
async function fixture(signedIn = true) {
  const db = new LocalDatabase(`mac-settings-${crypto.randomUUID()}`);
  const client = new Client({
    database: db,
    fetcher: vi.fn(async () => {
      throw new Error("Settings must not contact the cloud");
    }),
    vault: {
      read: async () =>
        signedIn
          ? JSON.stringify({
              kind: "api_key",
              apiKey: `settings-${crypto.randomUUID()}`,
              project: "test",
            })
          : "",
      write: async () => {},
    },
  });
  await client.restore();
  return client;
}
async function mount(element: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(label: string) {
  const result = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!result) throw new Error(`Missing settings button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("Mac settings model", () => {
  it("routes only the settings window and keeps sections bounded", () => {
    expect(isSettingsRoute("#/settings")).toBe(true);
    expect(isSettingsRoute("#/settings/permissions")).toBe(true);
    expect(isSettingsRoute("#/library/artifacts")).toBe(false);
    expect(isSettingsRoute("#/settingsfake")).toBe(false);
    expect(settingsRouteSection("#/settings/permissions")).toBe("permissions");
    expect(settingsRouteSection("#/settings/../../secret")).toBe("general");
    expect(settingsRouteSection("#/settings")).toBe("general");
    expect(settingsPath("data-controls")).toBe("#/settings/data-controls");
  });
  it("lists the reference sections and marks unconnected ones with a reason", () => {
    expect(settingsSections).toHaveLength(13);
    expect(settingsSections[0].id).toBe("general");
    expect(settingsSections.at(-1)!.id).toBe("legal");
    for (const section of settingsSections)
      expect(Boolean(section.unavailable)).toBe(!section.connected);
    expect(
      settingsSections.filter((s) => s.connected).map((s) => s.id),
    ).toEqual([
      "general",
      "connectors",
      "computer-use",
      "file-system",
      "dictation",
      "secure-storage",
      "permissions",
      "devices",
      "data-controls",
      "help",
      "legal",
    ]);
  });
  it("reports the resolved language and only a plausible native version", () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-Hans-CN", "en"]);
    expect(activeLanguage()).toMatchObject({
      language: "zh-CN",
      locale: "zh-CN",
      preferred: ["zh-Hans-CN", "en"],
    });
    vi.stubGlobal("__OPEN_MUSE_VERSION__", "0.2.0");
    expect(appVersion()).toBe("0.2.0");
    vi.stubGlobal("__OPEN_MUSE_VERSION__", "<script>alert(1)</script>");
    expect(appVersion()).toBe("");
    vi.stubGlobal("__OPEN_MUSE_VERSION__", undefined);
    expect(appVersion()).toBe("");
  });
  it("asks the native shell for its window and falls back when absent", () => {
    expect(openNativeSettings()).toBe(false);
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    expect(openNativeSettings()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ name: "settings" });
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          museWindow: {
            postMessage: () => {
              throw new Error("closed");
            },
          },
        },
      },
    });
    expect(openNativeSettings()).toBe(false);
  });
  it("provides every section translation", () => {
    for (const section of settingsSections) {
      expect(Object.hasOwn(zhCN, section.label), section.label).toBe(true);
      if (section.unavailable)
        expect(Object.hasOwn(zhCN, section.unavailable), section.id).toBe(true);
    }
  });
});

describe("Mac settings window", () => {
  it.each(["en", "zh-CN"])(
    "renders the %s sidebar and general pane",
    async (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      vi.stubGlobal("__OPEN_MUSE_VERSION__", "0.2.0");
      await mount(<SettingsWindow client={await fixture()} />);
      expect(
        host!.querySelectorAll(".settings-sidebar-items button"),
      ).toHaveLength(13);
      expect(host!.querySelector(".settings-main h1")?.textContent).toBe(
        language === "zh-CN" ? "通用" : "General",
      );
      expect(host!.textContent).toContain("0.2.0");
      expect(host!.textContent).toContain(
        language === "zh-CN" ? "退出" : "Sign out",
      );
    },
  );
  it("shows the real permission policy instead of editable controls", async () => {
    await mount(<SettingsWindow client={await fixture()} />);
    await click("Permissions");
    expect(location.hash).toBe("#/settings/permissions");
    // The provisioned agent toolset is always-allow, so the window must not
    // promise that every tool asks first.
    expect(host!.textContent).toContain("always-allow");
    expect(host!.textContent).toContain("runs those tools directly");
    expect(host!.textContent).toContain("web_search");
    expect(host!.textContent).toContain(
      "Every other pending permission request",
    );
    expect(host!.textContent).not.toContain("Every other tool");
    expect(host!.textContent).toContain("never retried automatically");
    expect(host!.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(host!.querySelectorAll("input[type=radio]")).toHaveLength(0);
  });
  it("matches the reference on the section names it leaves in English", async () => {
    for (const label of ["Computer use", "File system access", "Dictation"])
      expect(zhCN[label]).toBe(label);
    expect(zhCN["Sign out"]).toBe("退出");
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    await mount(<SettingsWindow client={await fixture()} />);
    const names = [
      ...host!.querySelectorAll(".settings-sidebar-items button"),
    ].map((item) => item.textContent);
    expect(names).toContain("Computer use");
    expect(names).toContain("File system access");
    expect(names).toContain("Dictation");
    expect(names).toContain("通用");
  });
  it("explains unconnected sections without simulating them", async () => {
    await mount(<SettingsWindow client={await fixture()} />);
    for (const id of ["Computer use", "Wallet"]) {
      await click(id);
      expect(host!.textContent).toContain("Not connected");
      expect(host!.querySelectorAll("input")).toHaveLength(0);
    }
    await click("Data controls");
    expect(host!.textContent).toContain("no server of its own");
  });
  it("keeps the connection summary, language and about groups on the first screen", async () => {
    const client = await fixture();
    await mount(<SettingsWindow client={client} />);
    // Grouped rows, not the shared panel's flat card, until the user asks.
    expect(
      host!.querySelectorAll(".settings-main .settings-group").length,
    ).toBe(6);
    expect(host!.querySelector(".settings-auth")).toBeNull();
    expect(host!.textContent).toContain("Connected");
    expect(host!.textContent).toContain("API Key");
    expect(host!.textContent).toContain("Interface language");
    expect(host!.textContent).toContain("Version");
    // Outside the Mac app the desktop group explains who controls it.
    expect(host!.textContent).toContain("Desktop presence");
    await click("Manage connection");
    expect(host!.querySelector(".settings-auth")).toBeTruthy();
    await click("Manage connection");
    expect(host!.querySelector(".settings-auth")).toBeNull();
  });
  it("reads the connection again when the window returns to view", async () => {
    const client = await fixture();
    const auth = vi.spyOn(client, "auth");
    await mount(<SettingsWindow client={client} />);
    const reads = () =>
      auth.mock.calls.filter(([path]) => path === "status").length;
    const before = reads();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(reads()).toBe(before + 1);
    await act(async () => {
      window.document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(reads()).toBe(before + 2);
  });
  it("keeps checking while signed out, so a finished sign-in appears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = await fixture(false);
    const auth = vi.spyOn(client, "auth");
    await mount(<SettingsWindow client={client} />);
    const reads = () =>
      auth.mock.calls.filter(([path]) => path === "status").length;
    const before = reads();
    await act(async () => {
      vi.advanceTimersByTime(5100);
      await Promise.resolve();
    });
    expect(reads()).toBeGreaterThan(before);
    vi.useRealTimers();
  });
  it("confirms a sign-out started by the shared connection panel", async () => {
    const client = await fixture();
    const auth = vi.spyOn(client, "auth");
    await mount(<SettingsWindow client={client} />);
    await click("Manage connection");
    await click("Sign out of this login");
    expect(host!.querySelector("dialog")?.textContent).toContain(
      "does not revoke the cloud API Key",
    );
    expect(auth).not.toHaveBeenCalledWith("logout", {});
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:first-child",
        )!
        .click(),
    );
    expect(auth).not.toHaveBeenCalledWith("logout", {});
    expect(host!.querySelector("dialog")).toBeNull();
    await click("Sign out of this login");
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:last-child",
        )!
        .click(),
    );
    expect(auth).toHaveBeenCalledWith("logout", {});
  });
  it("starts the section list below the window's traffic lights", () => {
    const css = readFileSync("macos/ui/settings.css", "utf8");
    const top = /\.settings-sidebar \{[^}]*padding: (\d+)px/.exec(css);
    expect(Number(top?.[1])).toBeGreaterThanOrEqual(36);
    // The reference fills its groups rather than outlining them.
    expect(css).toMatch(/\.settings-group \{[^}]*background: var\(--fill\)/);
  });
  it("requires confirmation before signing this Mac out", async () => {
    const client = await fixture();
    const auth = vi.spyOn(client, "auth");
    await mount(<SettingsWindow client={client} />);
    await click("Sign out");
    expect(host!.querySelector("dialog")?.textContent).toContain(
      "does not revoke the cloud API Key",
    );
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:first-child",
        )!
        .click(),
    );
    expect(auth).not.toHaveBeenCalledWith("logout", {});
    await click("Sign out");
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:last-child",
        )!
        .click(),
    );
    expect(auth).toHaveBeenCalledWith("logout", {});
  });
  it("renders before the Keychain login is restored and refreshes after it", async () => {
    let settle: (value: string) => void = () => {};
    const client = await fixture();
    vi.spyOn(client, "restore").mockReturnValue(
      new Promise<void>((resolve) => {
        settle = () => resolve();
      }),
    );
    const status = vi.spyOn(client, "auth");
    await mount(<SettingsWindow client={client} />);
    // A pending or denied secure-storage read must not blank the window.
    expect(
      host!.querySelectorAll(".settings-sidebar-items button"),
    ).toHaveLength(13);
    expect(host!.querySelector(".settings-segments")).toBeTruthy();
    status.mockClear();
    await act(async () => {
      settle("");
      await restoreInBackground(client);
    });
    expect(status).toHaveBeenCalledWith("status");
    expect(host!.querySelector(".settings-error")).toBeNull();
  });
  it("reports a denied secure-storage read with a retry instead of hanging", async () => {
    const client = await fixture();
    vi.spyOn(client, "restore").mockRejectedValue(
      new Error("Cannot restore secure credentials"),
    );
    await mount(<SettingsWindow client={client} />);
    await act(async () => {
      await restoreInBackground(client);
    });
    expect(host!.querySelector(".settings-error")?.textContent).toContain(
      "Cannot restore secure credentials",
    );
    expect(
      host!.querySelectorAll(".settings-sidebar-items button"),
    ).toHaveLength(13);
    await click("Try again");
    expect(client.restore).toHaveBeenCalledTimes(2);
  });
  it("keeps the native shell's window contract", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    // Fixed 800 x 600, closable only: the reference disables zoom and resize.
    expect(swift).toContain("NSRect(x: 0, y: 0, width: 800, height: 600)");
    expect(swift).toContain(
      "styleMask: [.titled, .closable, .fullSizeContentView]",
    );
    expect(swift).toContain('URL(string: "muse://app/#/settings")');
    // Callbacks answer the web view that asked, not always the workspace.
    expect(swift).toContain("guard let sender = message.webView");
    expect(swift).toContain("guard sender === window else { return true }");
    for (const file of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${file}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Settings" =');
  });
});
