import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { zhDesktop } from "../../shared/locales/zh-CN-desktop";
import { parsePresence, type Presence } from "../ui/presence";
import { PresenceSettings } from "../ui/PresenceSettings";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});

function nativeShell(initial: Presence, answer?: (body: object) => unknown) {
  let state = { ...initial };
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (answer) return answer(body);
    if (body.operation === "write") {
      const on = body.value === "true";
      // macOS holds a new login item for approval instead of enabling it.
      if (body.key === "startup")
        state.startup = on ? "requires-approval" : "not-registered";
      else state = { ...state, [body.key]: on };
    }
    return state;
  });
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { musePresence: { postMessage } } },
  });
  return postMessage;
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<PresenceSettings />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
function toggle(label: string) {
  const row = [...host!.querySelectorAll("label")].find((item) =>
    item.textContent?.startsWith(label),
  );
  const input = row?.querySelector<HTMLInputElement>("input[role=switch]");
  if (!input) throw new Error(`Missing switch: ${label}`);
  return input;
}
async function flip(label: string) {
  await act(async () => toggle(label).click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

describe("Mac desktop presence", () => {
  it("accepts only a complete state from the shell", () => {
    expect(
      parsePresence({
        startup: "enabled",
        menuBar: true,
        floatingButton: false,
      }),
    ).toEqual({ startup: "enabled", menuBar: true, floatingButton: false });
    expect(
      parsePresence({ startup: "on", menuBar: true, floatingButton: true }),
    ).toBeUndefined();
    expect(
      parsePresence({ startup: "enabled", menuBar: "yes" }),
    ).toBeUndefined();
    expect(parsePresence(null)).toBeUndefined();
  });
  it("explains the rows outside the Mac app instead of rendering switches", async () => {
    await mount();
    expect(host!.querySelector("input[role=switch]")).toBeNull();
    expect(host!.textContent).toContain("controlled by the Mac app");
  });
  it("shows the state the shell reports and writes each change through it", async () => {
    const post = nativeShell({
      startup: "not-registered",
      menuBar: true,
      floatingButton: true,
    });
    await mount();
    expect(post).toHaveBeenCalledWith({ operation: "read" });
    expect(toggle("Run on startup").checked).toBe(false);
    expect(toggle("Show in menu bar").checked).toBe(true);
    expect(toggle("Show floating button").checked).toBe(true);

    await flip("Show in menu bar");
    expect(post).toHaveBeenCalledWith({
      operation: "write",
      key: "menuBar",
      value: "false",
    });
    expect(toggle("Show in menu bar").checked).toBe(false);

    await flip("Run on startup");
    // A login item waiting for approval reads as on, with the reason and a
    // way to reach System Settings.
    expect(toggle("Run on startup").checked).toBe(true);
    expect(host!.textContent).toContain("waiting for you to allow");
    const open = [...host!.querySelectorAll("button")].find(
      (item) => item.textContent === "Open Login Items",
    );
    await act(async () => open!.click());
    expect(post).toHaveBeenCalledWith({ operation: "login-items" });
  });
  it("keeps the reported state when the shell refuses a change", async () => {
    const state: Presence = {
      startup: "not-registered",
      menuBar: true,
      floatingButton: true,
    };
    nativeShell(state, async (body) => {
      if ((body as { operation: string }).operation === "write")
        throw new Error("macOS did not change the login item.");
      return state;
    });
    await mount();
    await flip("Run on startup");
    expect(toggle("Run on startup").checked).toBe(false);
    expect(host!.querySelector("[role=alert]")?.textContent).toBe(
      "Could not change the app settings.",
    );
  });
  it("translates every desktop string and registers the catalog", () => {
    const source = readFileSync("macos/ui/PresenceSettings.tsx", "utf8");
    for (const [, key] of source.matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
    for (const key of Object.keys(zhDesktop))
      expect(zhCN[key]).toBe(zhDesktop[key]);
    for (const file of ["en", "zh-Hans"]) {
      const strings = readFileSync(
        `macos/${file}.lproj/Localizable.strings`,
        "utf8",
      );
      expect(strings).toContain('"Show Open Muse" =');
      expect(strings).toContain('"macOS did not change the login item." =');
    }
  });
  it("keeps the shell's presence contract", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain('name: "musePresence"');
    expect(swift).toContain("SMAppService.mainApp");
    // The floating button stands in for the closed workspace window only.
    expect(swift).toContain("(!window.isVisible || window.isMiniaturized)");
    expect(swift).toContain("accessibilityDisplayShouldReduceMotion");
  });
});

describe("floating pill", () => {
  it("tells the shell the companion's name and what it is doing", async () => {
    const { postCompanion } = await import("../ui/presence");
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    postCompanion("Muse", "thinking");
    expect(postMessage).toHaveBeenCalledWith({
      name: "companion",
      value: "Muse",
      state: "thinking",
    });
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    // Only the workspace may rename the pill, and unknown states read as idle.
    expect(swift).toContain(
      'body?["name"] == "companion", message.webView === webView',
    );
    expect(swift).toContain('case "speaking": state = localized("Speaking")');
    for (const lang of ["en", "zh-Hans"]) {
      const strings = readFileSync(
        `macos/${lang}.lproj/Localizable.strings`,
        "utf8",
      );
      for (const key of [
        "Thinking",
        "Speaking",
        "Space",
        "Press %@ to start a chat",
      ])
        expect(strings, `${lang}: ${key}`).toContain(`"${key}" =`);
    }
  });
});
