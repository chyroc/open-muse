import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { FileSystemSettings } from "../ui/FileSystemSettings";

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

describe("Mac file system access", () => {
  it("shows Full Disk Access and manages blocked folders", async () => {
    let state = {
      enabled: true,
      accessibility: true,
      screen: true,
      keepAwake: false,
      blocked: [],
      fullDiskAccess: false,
      blockedFolders: [] as string[],
    };
    const postMessage = vi.fn(async (body: Record<string, string>) => {
      if (body.operation === "block-folder")
        state = { ...state, blockedFolders: ["/Users/me/Taxes"] };
      if (body.operation === "unblock-folder")
        state = {
          ...state,
          blockedFolders: state.blockedFolders.filter((p) => p !== body.path),
        };
      return state;
    });
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museComputer: { postMessage } } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<FileSystemSettings />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    const button = (label: string) =>
      [...host!.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      )!;
    await act(async () => button("Open System Settings").click());
    expect(postMessage).toHaveBeenCalledWith({ operation: "full-disk-access" });
    await act(async () => button("Add folder").click());
    // The row names the folder; the full path is its tooltip.
    expect(host!.textContent).toContain("Taxes");
    expect(
      host!.querySelector('.computer-blocked-row[title="/Users/me/Taxes"]'),
    ).not.toBeNull();
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          '[aria-label="Unblock /Users/me/Taxes"]',
        )!
        .click(),
    );
    expect(postMessage).toHaveBeenCalledWith({
      operation: "unblock-folder",
      path: "/Users/me/Taxes",
    });
    expect(host!.textContent).not.toContain("Taxes");
  });
  it("translates its copy", () => {
    for (const [, key] of readFileSync(
      "macos/ui/FileSystemSettings.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
});
