import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  applyTheme,
  initializeAppearance,
  saveTheme,
  storedTheme,
  themeColors,
} from "../ui/appearance";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("Mac theme color", () => {
  it("stores the choice on this device and applies it to the page", () => {
    // Matching the avatar is the default, and it uses the standard accent.
    expect(storedTheme()).toBe("avatar");
    saveTheme("purple");
    expect(localStorage.getItem("muse.theme")).toBe("purple");
    expect(document.documentElement.dataset.theme).toBe("purple");
    saveTheme("avatar");
    expect(localStorage.getItem("muse.theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    saveTheme("default");
    expect(storedTheme()).toBe("default");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    localStorage.setItem("muse.theme", "neon");
    expect(storedTheme()).toBe("avatar");
  });
  it("follows a change made in the other window", () => {
    initializeAppearance();
    localStorage.setItem("muse.theme", "green");
    window.dispatchEvent(new StorageEvent("storage", { key: "muse.theme" }));
    expect(document.documentElement.dataset.theme).toBe("green");
  });
  it("defines every palette in both appearances and translates its name", () => {
    const css = readFileSync("macos/ui/theme.css", "utf8");
    for (const { id, label } of themeColors) {
      expect(zhCN[label], label).toBeTruthy();
      if (id === "avatar" || id === "default") continue;
      expect(css).toContain(`:root[data-theme="${id}"]`);
      expect(css).toContain(
        `:root[data-appearance="dark"][data-theme="${id}"]`,
      );
    }
    expect(applyTheme("default")).toBe("default");
  });
  it("offers the palettes as one radio group in General settings", async () => {
    const { SettingsWindow } = await import("../ui/SettingsWindow");
    const { Client } = await import("../../src/api");
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () =>
      root.render(
        <SettingsWindow
          client={
            new Client({
              vault: { read: async () => "", write: async () => {} },
            })
          }
        />,
      ),
    );
    const group = host.querySelector(
      '[role=radiogroup][aria-label="Theme color"]',
    )!;
    const options = [...group.querySelectorAll("[role=radio]")];
    expect(options.map((item) => item.getAttribute("aria-label"))).toEqual(
      themeColors.map((item) => item.label),
    );
    await act(async () => (options[3] as HTMLButtonElement).click());
    expect(document.documentElement.dataset.theme).toBe("purple");
    expect(options[3].getAttribute("aria-checked")).toBe("true");
    await act(async () => root.unmount());
    host.remove();
  });
});
