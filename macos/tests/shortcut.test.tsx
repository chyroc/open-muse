import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { carbon, recordShortcut, shortcutLabel } from "../ui/shortcut";
import { ShortcutSettings } from "../ui/ShortcutSettings";

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
const press = (code: string, keys: Partial<Record<string, boolean>> = {}) => ({
  code,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...keys,
});

describe("Mac Quick chat shortcut", () => {
  it("records only combinations with Command, Option or Control", () => {
    expect(recordShortcut(press("Space", { altKey: true }))).toEqual({
      code: 49,
      modifiers: carbon.option,
    });
    expect(
      recordShortcut(press("KeyM", { metaKey: true, shiftKey: true })),
    ).toEqual({ code: 46, modifiers: carbon.command | carbon.shift });
    expect(recordShortcut(press("KeyM", { shiftKey: true }))).toBeUndefined();
    expect(recordShortcut(press("F13", { metaKey: true }))).toBeUndefined();
    expect(shortcutLabel({ code: 49, modifiers: carbon.option })).toBe(
      "⌥Space",
    );
    expect(
      shortcutLabel({
        code: 46,
        modifiers: carbon.control | carbon.shift | carbon.command,
      }),
    ).toBe("⌃⇧⌘M");
  });
  it("records a new shortcut, reports a refused one and resets", async () => {
    let state = { code: 49, modifiers: carbon.option, registered: true };
    const postMessage = vi.fn(async (body: Record<string, string>) => {
      if (body.operation === "write")
        state = {
          code: Number(body.code),
          modifiers: Number(body.modifiers),
          registered: false,
        };
      if (body.operation === "reset")
        state = { code: 49, modifiers: carbon.option, registered: true };
      return state;
    });
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museShortcut: { postMessage } } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<ShortcutSettings />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    const field = host.querySelector<HTMLButtonElement>(".shortcut-field")!;
    expect(field.textContent).toBe("⌥Space");
    expect(host.textContent).not.toContain("Reset");
    await act(async () => field.click());
    expect(field.textContent).toBe("Type a shortcut…");
    // A bare letter is not a shortcut and keeps listening.
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyK", key: "k", bubbles: true }),
      );
    });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "write" }),
    );
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyK",
          key: "k",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(postMessage).toHaveBeenCalledWith({
      operation: "write",
      code: "40",
      modifiers: String(carbon.control | carbon.option),
    });
    expect(field.textContent).toBe("⌃⌥K");
    expect(host.textContent).toContain("did not accept this shortcut");
    const reset = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Reset",
    )!;
    await act(async () => reset.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(field.textContent).toBe("⌥Space");
  });
  it("translates its copy and keeps the native contract", () => {
    for (const [, key] of readFileSync(
      "macos/ui/ShortcutSettings.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
    expect(zhCN.Shortcuts).toBeTruthy();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain('name: "museShortcut"');
    expect(swift).toContain("UnregisterEventHotKey(ref)");
  });
});
