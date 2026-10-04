import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAppearance,
  modeSupported,
  readAppearance,
  saveAppearance,
} from "../src/appearance";
import { t } from "../shared/i18n";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}
function root() {
  const properties = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) =>
        void properties.set(name, value),
    },
    properties,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Appearance", () => {
  it("defaults to the companion's colors, a large avatar and the system mode", () => {
    vi.stubGlobal("localStorage", storage());
    expect(readAppearance()).toEqual({
      theme: "avatar",
      size: "large",
      mode: "system",
    });
  });

  it("keeps changes on this device and applies them to the page and the app", () => {
    const saved = storage();
    const element = root();
    const postMessage = vi.fn();
    vi.stubGlobal("localStorage", saved);
    vi.stubGlobal("document", { documentElement: element });
    vi.stubGlobal("webkit", {
      messageHandlers: { museAppearance: { postMessage } },
    });
    expect(modeSupported()).toBe(true);
    saveAppearance({ theme: "lilac", size: "small", mode: "dark" });
    expect(readAppearance()).toEqual({
      theme: "lilac",
      size: "small",
      mode: "dark",
    });
    expect(element.dataset).toMatchObject({
      chatTheme: "lilac",
      avatarSize: "small",
    });
    expect(Number(element.properties.get("--companion-zoom"))).toBeCloseTo(
      44 / 68,
    );
    expect(postMessage).toHaveBeenLastCalledWith("dark");
    // Back to every default, nothing is kept.
    saveAppearance({ theme: "avatar", size: "large", mode: "system" });
    expect(saved.values.size).toBe(0);
    applyAppearance();
    expect(postMessage).toHaveBeenLastCalledWith("system");
  });

  it("ignores values it does not know", () => {
    const saved = storage();
    saved.setItem(
      "open-muse.appearance",
      JSON.stringify({ theme: "neon", size: "huge", mode: "sepia" }),
    );
    vi.stubGlobal("localStorage", saved);
    expect(readAppearance()).toEqual({
      theme: "avatar",
      size: "large",
      mode: "system",
    });
    saved.setItem("open-muse.appearance", "{not json");
    expect(readAppearance().theme).toBe("avatar");
    expect(modeSupported()).toBe(false);
  });

  it("names every choice in Simplified Chinese", () => {
    expect(t("Chat theme", {}, "zh-CN")).toBe("聊天主题");
    expect(t("Avatar size", {}, "zh-CN")).toBe("虚拟形象大小");
    expect(t("Extra large", {}, "zh-CN")).toBe("加大");
    expect(t("Hidden", {}, "zh-CN")).toBe("已隐藏");
  });
});
