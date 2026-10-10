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
  connectionRoute,
  connectionSummary,
  isConnectionRoute,
  isSettingsRoute,
  openNativeSettings,
  settingsPath,
  settingsRouteSection,
  settingsSections,
} from "../ui/settings";
import { SettingsWindow } from "../ui/SettingsWindow";
import { backgroundClient } from "../../src/background-client";
import { connectionReady, restoreInBackground } from "../ui/startup";
import { AccountSettings } from "../ui/AccountSettings";
import { vaultAccount } from "./account";

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
  vi.restoreAllMocks();
});
// An Open Muse account, as the service reports one after sign-in.
function signedInAccount() {
  vi.spyOn(backgroundClient, "accountOwner").mockReturnValue("muse_user_abc");
  vi.spyOn(backgroundClient, "accountEmail").mockReturnValue(
    "person@example.com",
  );
}
async function fixture(signedIn = true) {
  const db = new LocalDatabase(`mac-settings-${crypto.randomUUID()}`);
  const client = new Client({
    database: db,
    fetcher: vi.fn(async () => {
      throw new Error("Settings must not contact the cloud");
    }),
    account: vaultAccount(async () =>
      signedIn
        ? JSON.stringify({
            kind: "api_key",
            apiKey: `settings-${crypto.randomUUID()}`,
            project: "test",
          })
        : "",
    ),
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
    expect(openNativeSettings(connectionRoute)).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith({
      name: "settings",
      value: "connection",
    });
    expect(isConnectionRoute("#/settings/connection")).toBe(true);
    expect(isConnectionRoute("#/settings/general")).toBe(false);
    expect(settingsRouteSection("#/settings/connection")).toBe("general");
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
  it("names email as the sign-in method", () => {
    expect(
      connectionSummary({
        loggedIn: true,
        ready: true,
        method: "api_key",
        account: { signedIn: true },
      }).method,
    ).toBe("Email");
    expect(
      connectionSummary({
        loggedIn: false,
        ready: false,
        account: { signedIn: false },
      }).method,
    ).toBe("");
    expect(zhCN.Email).toBe("邮箱");
  });
  it("separates a signed-in account without an Ark key from a signed-out one", () => {
    expect(connectionSummary(undefined).state).toBe("Not signed in");
    expect(
      connectionSummary({
        loggedIn: false,
        ready: false,
        account: { signedIn: false },
      }).state,
    ).toBe("Not signed in");
    expect(
      connectionSummary({
        loggedIn: false,
        ready: false,
        account: { signedIn: true },
      }).state,
    ).toBe("Not connected");
    expect(
      connectionSummary({
        loggedIn: true,
        ready: true,
        account: { signedIn: true },
      }).state,
    ).toBe("Connected");
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
      // Signing out is in the account section, not the sidebar.
      expect(
        host!.querySelector(".settings-sidebar")?.textContent,
      ).not.toContain(language === "zh-CN" ? "退出" : "Sign out");
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
    // The one choice here is whether this device approves web requests the
    // agent asks about; it can only make approvals stricter.
    const radios = [
      ...host!.querySelectorAll<HTMLInputElement>("input[type=radio]"),
    ];
    expect(radios.map((item) => item.value)).toEqual(["some", "always"]);
    expect(radios[0].checked).toBe(true);
    await act(async () => radios[1].click());
    expect(localStorage.getItem("open-muse.webAccess")).toBe("always");
    expect(host!.textContent).not.toContain("Pending web_search");
    await act(async () => radios[0].click());
    expect(localStorage.getItem("open-muse.webAccess")).toBeNull();
    expect(host!.textContent).not.toContain("Connector defaults");
  });
  it("picks the app language and keeps following the system by default", async () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-Hans-CN", "en"]);
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    localStorage.removeItem("open-muse.language");
    await mount(<SettingsWindow client={await fixture()} />);
    // The language lives on its own page behind General > Language.
    await act(async () =>
      [...host!.querySelectorAll<HTMLButtonElement>(".settings-nav-row")]
        .find((item) => item.textContent === "语言")!
        .click(),
    );
    expect(host!.querySelector("h1")!.textContent).toBe("语言偏好");
    const options = () => [
      ...host!.querySelectorAll<HTMLLabelElement>(".settings-radio-row"),
    ];
    const radio = (value: string) =>
      host!.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    expect(options().map((item) => item.textContent)).toEqual([
      "跟随系统 (简体中文)",
      "English",
      "简体中文",
    ]);
    expect(radio("system").checked).toBe(true);
    await act(async () => radio("en").click());
    expect(localStorage.getItem("open-muse.language")).toBe("en");
    expect(postMessage).toHaveBeenCalledWith({ name: "language", value: "en" });
    expect(activeLanguage()).toMatchObject({
      language: "en",
      choice: "en",
      device: "zh-CN",
    });
    await act(async () => radio("system").click());
    expect(localStorage.getItem("open-muse.language")).toBeNull();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain(
      'body?["name"] == "language", message.webView === settingsWebView',
    );
    // The page sees the system's list, not this app's own override.
    expect(swift).toContain(
      "persistentDomain(forName: UserDefaults.globalDomain)",
    );
  });
  it("says what the Open Muse service keeps", async () => {
    await mount(<SettingsWindow client={await fixture()} />);
    await click("Data controls");
    expect(host!.textContent).toContain(
      "Chats go straight to your Ark project.",
    );
    expect(host!.textContent).toContain("With the Open Muse service");
    expect(host!.textContent).toContain("your Ark key encrypted");
    expect(host!.textContent).not.toContain("has no server of its own");
  });
  it("shows the account's key once the login restores after the window opened", async () => {
    signedInAccount();
    const client = await fixture();
    const auth = vi
      .spyOn(client, "auth")
      .mockResolvedValue({ ready: false } as never);
    await mount(
      <AccountSettings
        client={client}
        onChanged={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host!.textContent).toContain("Not connected");
    auth.mockResolvedValue({ ready: true } as never);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(connectionReady, { detail: "" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host!.textContent).toContain("Saved in your Open Muse account");
  });
  it("opens the settings window centered over the main window", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain(
      "var origin = NSPoint(x: main.frame.midX - size.width / 2, y: main.frame.midY - size.height / 2)",
    );
    expect(swift).toContain("(main.screen ?? NSScreen.main)?.visibleFrame");
  });
  it("names every section in Chinese", async () => {
    expect(zhCN["Sign out"]).toBe("退出");
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    await mount(<SettingsWindow client={await fixture()} />);
    const names = [
      ...host!.querySelectorAll(".settings-sidebar-items button"),
    ].map((item) => item.textContent);
    expect(names).toContain("电脑使用");
    expect(names).toContain("文件系统访问权限");
    expect(names).toContain("语音输入");
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
    expect(host!.textContent).toContain(
      "Chats go straight to your Ark project",
    );
  });
  it("shows the account in grouped rows, with language and about, on the first screen", async () => {
    const client = await fixture();
    signedInAccount();
    await mount(<SettingsWindow client={client} />);
    // Grouped rows, not the shared panel's card.
    expect(host!.querySelector(".settings-auth")).toBeNull();
    const text = host!.textContent!;
    expect(text).toContain("person@example.com");
    expect(text).toContain("Ark API Key");
    expect(text).toContain("Export my data");
    expect(text).toContain("Delete account");
    expect(text).toContain("Account ID: abc");
    expect(text.indexOf("Export my data")).toBeLessThan(
      text.indexOf("Delete account"),
    );
    // No disclosure, workspace row, or webhooks.
    expect(text).not.toContain("Manage connection");
    expect(text).not.toContain("Personal workspace");
    expect(text).not.toContain("Webhook");
    expect(text).toContain("Language");
    expect(text).toContain("Version");
    // Outside the Mac app the desktop group explains who controls it.
    expect(text).toContain("Desktop presence");
  });
  it("opens a connect request on the focused sign-in controls", async () => {
    const client = await fixture(false);
    location.hash = "#/settings/connection";
    await mount(<SettingsWindow client={client} />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const auth = host!.querySelector(".settings-auth");
    expect(auth).toBeTruthy();
    expect(auth!.contains(document.activeElement)).toBe(true);
    expect(location.hash).toBe("#/settings/general");
    // From another section, a second request comes back to the same place.
    await click("Dictation");
    await act(async () => {
      location.hash = "#/settings/connection";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host!.querySelector(".settings-main h1")?.textContent).toBe(
      "General",
    );
    expect(host!.querySelector(".settings-auth")).toBeTruthy();
    expect(location.hash).toBe("#/settings/general");
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
  it("asks before removing the Ark key from the account", async () => {
    const client = await fixture();
    const auth = vi.spyOn(client, "auth");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    signedInAccount();
    await mount(<SettingsWindow client={client} />);
    await click("Remove API key from my account");
    expect(confirm).toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalledWith("logout", { confirm: true });
  });
  it("starts the section list below the window's traffic lights", () => {
    const css = readFileSync("macos/ui/settings.css", "utf8");
    const top = /\.settings-sidebar \{[^}]*padding: (\d+)px/.exec(css);
    expect(Number(top?.[1])).toBeGreaterThanOrEqual(36);
    // The reference fills its groups rather than outlining them.
    expect(css).toMatch(/\.settings-group \{[^}]*background: var\(--fill\)/);
  });
  it("requires confirmation before signing this Mac out of the account", async () => {
    const client = await fixture();
    const auth = vi.spyOn(client, "auth");
    const signOut = vi
      .spyOn(backgroundClient, "signOutAccount")
      .mockResolvedValue({ revoked: true });
    const changed = vi.spyOn(client, "accountChanged");
    signedInAccount();
    await mount(<SettingsWindow client={client} />);
    // It sits with the account itself.
    const group = button("Sign out of Open Muse").closest(".settings-group");
    expect(group?.textContent).toContain("person@example.com");
    expect(group?.textContent).not.toContain("Delete account");
    await click("Sign out of Open Muse");
    expect(host!.querySelector("dialog")?.textContent).toContain(
      "Other devices stay signed in. Nothing is deleted.",
    );
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:first-child",
        )!
        .click(),
    );
    expect(signOut).not.toHaveBeenCalled();
    await click("Sign out of Open Muse");
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:last-child",
        )!
        .click(),
    );
    expect(signOut).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
    // Signing out never removes the account's Ark key.
    expect(auth).not.toHaveBeenCalledWith("logout", expect.anything());
    signOut.mockRestore();
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
    expect(swift).toContain('?? "#/settings"');
    expect(swift).toContain('URL(string: "muse://app/\\(route)")');
    // A new window loads straight into a requested section.
    expect(swift).toContain("showSettings(section: section)");
    // Callbacks answer the web view that asked, not always the workspace.
    expect(swift).toContain("guard let sender = message.webView");
    expect(swift).toContain("guard sender === window else { return true }");
    for (const file of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${file}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Settings" =');
  });
});
