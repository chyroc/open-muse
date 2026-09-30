import "fake-indexeddb/auto";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  applyAppearance,
  appearances,
  initializeAppearance,
  resolveAppearance,
  saveAppearance,
  storedAppearance,
  systemPrefersDark,
} from "../ui/appearance";
import { SettingsWindow } from "../ui/SettingsWindow";
import { contrast, paintedRules, themeTokens } from "./contrast";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let listeners: ((event: { matches: boolean }) => void)[] = [];
function stubMedia(dark: boolean) {
  listeners = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
      listeners.push(fn),
    removeEventListener: () => {},
  }));
}
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.appearance;
  stubMedia(false);
});
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
async function fixture() {
  const client = new Client({
    database: new LocalDatabase(`mac-appearance-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("Appearance must not contact the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `appearance-${crypto.randomUUID()}`,
          project: "test",
        }),
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("Mac appearance preference", () => {
  it("defaults to the system appearance and resolves it", () => {
    expect(storedAppearance()).toBe("system");
    expect(systemPrefersDark()).toBe(false);
    expect(resolveAppearance("system")).toBe("light");
    stubMedia(true);
    expect(systemPrefersDark()).toBe(true);
    expect(resolveAppearance("system")).toBe("dark");
    expect(resolveAppearance("light")).toBe("light");
  });
  it("stores only a known choice and survives unreadable storage", () => {
    expect(saveAppearance("dark")).toBe("dark");
    expect(localStorage.getItem("muse.appearance")).toBe("dark");
    expect(storedAppearance()).toBe("dark");
    expect(document.documentElement.dataset.appearance).toBe("dark");
    saveAppearance("system");
    expect(localStorage.getItem("muse.appearance")).toBeNull();
    expect(document.documentElement.dataset.appearance).toBe("light");
    localStorage.setItem("muse.appearance", "neon");
    expect(storedAppearance()).toBe("system");
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(storedAppearance()).toBe("system");
    get.mockRestore();
  });
  it("follows macOS only while the choice is system", () => {
    initializeAppearance();
    expect(document.documentElement.dataset.appearance).toBe("light");
    act(() => listeners.forEach((fn) => fn({ matches: true })));
    stubMedia(true);
    act(() => listeners.forEach((fn) => fn({ matches: true })));
    saveAppearance("light");
    act(() => listeners.forEach((fn) => fn({ matches: true })));
    expect(document.documentElement.dataset.appearance).toBe("light");
  });
  it("tells the native shell the choice, not the resolved value", () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    saveAppearance("system");
    expect(postMessage).toHaveBeenLastCalledWith({
      name: "appearance",
      value: "system",
    });
    saveAppearance("dark");
    expect(postMessage).toHaveBeenLastCalledWith({
      name: "appearance",
      value: "dark",
    });
    // A refresh from the other window must not echo back to the shell.
    postMessage.mockClear();
    applyAppearance("dark", false);
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("keeps every Mac stylesheet on the shared tokens", () => {
    const theme = readFileSync("macos/ui/theme.css", "utf8");
    expect(theme).toContain('[data-appearance="dark"]');
    const tokens = [...theme.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map(
      (match) => match[1],
    );
    const light = tokens.slice(0, tokens.indexOf("--blue") + 1);
    const dark = tokens.slice(tokens.indexOf("--blue") + 1);
    expect(new Set(light)).toEqual(new Set(dark));
    // Surfaces and text must not stay hard-coded outside the token file.
    const banned =
      /#(fff|ffffff|fcfcfc|fdfdfd|f5f5f6|f3f4f5|242424|111112|6f6f75|858589|0668cf)\b/;
    for (const file of readdirSync("macos/ui").filter((f) =>
      f.endsWith(".css"),
    )) {
      if (file === "theme.css") continue;
      const css = readFileSync(`macos/ui/${file}`, "utf8");
      expect(banned.test(css), file).toBe(false);
      // The white keyword and hard-coded foregrounds break the dark surfaces.
      expect(/background: *white/.test(css), file).toBe(false);
      expect(/color: *#(9d3023|805a15|913e2c|a13b2b)/.test(css), file).toBe(
        false,
      );
      // Only the token file may define tokens: redefining one elsewhere can
      // self-reference it and silently invalidate the theme.
      expect(/^\s+--[a-z0-9-]+:/m.test(css), file).toBe(false);
    }
  });
  it("syncs the window chrome natively and both windows together", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain('body?["name"] == "appearance"');
    expect(swift).toContain("NSAppearance(named: .darkAqua)");
    expect(swift).toContain("NSApplication.shared.appearance = appearance");
    expect(swift).toContain("muse-appearance-changed");
  });
  it("keeps every self-painted rule legible in both appearances", () => {
    const { light, dark } = themeTokens();
    const rules = paintedRules();
    // Every rule that paints its own background and text is checked as a pair,
    // which is how the invisible save label reached a build: its tokens existed,
    // but the pair resolved to white on white in one appearance.
    expect(rules.length).toBeGreaterThan(10);
    const unreadable = rules.flatMap((rule) =>
      (["light", "dark"] as const).flatMap((appearance) => {
        const ratio = contrast(rule, appearance === "light" ? light : dark);
        return ratio === undefined || ratio >= 3
          ? []
          : [`${rule.file} ${rule.selector} ${appearance} ${ratio.toFixed(2)}`];
      }),
    );
    expect(unreadable).toEqual([]);
  });
  it("resolves a white-on-white pair as unreadable", () => {
    const { dark } = themeTokens();
    const ratio = contrast(
      {
        file: "probe.css",
        selector: ".probe",
        background: "var(--text)",
        color: "white",
      },
      dark,
    );
    expect(ratio).toBeDefined();
    expect(ratio!).toBeLessThan(1.1);
  });
  it("translates every appearance option", () => {
    for (const option of appearances)
      expect(Object.hasOwn(zhCN, option.label), option.label).toBe(true);
    expect(zhCN.Light).toBe("浅色");
    expect(zhCN.Dark).toBe("深色");
  });
});

describe("Mac appearance control", () => {
  it("switches the document and keeps the choice after a remount", async () => {
    await mount(<SettingsWindow client={await fixture()} />);
    const segment = (label: string) =>
      host!.querySelector<HTMLButtonElement>(
        `.settings-segments button[aria-label="${label}"]`,
      )!;
    expect(segment("System").getAttribute("aria-checked")).toBe("true");
    await act(async () => segment("Dark").click());
    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(segment("Dark").getAttribute("aria-checked")).toBe("true");
    expect(segment("System").getAttribute("aria-checked")).toBe("false");
    await act(async () => root!.unmount());
    root = undefined;
    await mount(<SettingsWindow client={await fixture()} />);
    expect(
      host!
        .querySelector('.settings-segments button[aria-label="Dark"]')!
        .getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => segment("Light").click());
    expect(document.documentElement.dataset.appearance).toBe("light");
  });
});
