import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { HelpSettings } from "../ui/HelpSettings";
import { LegalSettings } from "../ui/LegalSettings";
import { diagnosticReport } from "../ui/diagnostics";
import { backgroundClient } from "../../src/background-client";
import { shortcuts } from "../ui/Shortcuts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}

describe("Mac help and legal settings", () => {
  it("lists every shortcut and how to reach the Mac features", async () => {
    await mount(<HelpSettings />);
    for (const { keys } of shortcuts) expect(host!.textContent).toContain(keys);
    expect(host!.textContent).toContain("Press ⌥Space over any app");
    expect(host!.querySelector("input, a")).toBeNull();
  });
  it("loads the bundled notices only when asked", async () => {
    const fetcher = vi.fn(async () => new Response("react 19\nMIT License"));
    vi.stubGlobal("fetch", fetcher);
    await mount(<LegalSettings />);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => host!.querySelector("button")!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(fetcher).toHaveBeenCalledWith("notices.txt");
    expect(host!.querySelector("pre")?.textContent).toContain("MIT License");
  });
  it("reads notices the app serves without an HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 0,
        text: async () => "react 19\nMIT License",
      })),
    );
    await mount(<LegalSettings />);
    await act(async () => host!.querySelector("button")!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host!.querySelector("pre")?.textContent).toContain("MIT License");
  });
  it("leaves the notices out, without a message, when there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await mount(<LegalSettings />);
    await act(async () => host!.querySelector("button")!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host!.textContent).not.toContain("Open source notices");
    expect(host!.querySelector(".settings-notices")).toBeNull();
    expect(host!.textContent).not.toContain("app bundle");
  });
  it("copies a setup summary without keys or identifiers", async () => {
    vi.stubGlobal("__OPEN_MUSE_VERSION__", "5.0 (12)");
    vi.stubGlobal("__OPEN_MUSE_SYSTEM__", "macOS Version 15.1 (Build 24B83)");
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          museComputer: {
            postMessage: async () => ({
              enabled: true,
              accessibility: true,
              screen: false,
              keepAwake: false,
              blocked: [{ id: "com.example.secret", name: "Secret App" }],
              fullDiskAccess: false,
              blockedFolders: ["/Users/someone/Private"],
              calendar: {
                enabled: true,
                events: "allowed",
                reminders: "denied",
              },
              location: { enabled: false, permission: "not-asked" },
            }),
          },
        },
      },
    });
    const report = await diagnosticReport({ signedIn: true });
    expect(report).toContain("Open Muse 5.0 (12)");
    expect(report).toContain("macOS Version 15.1 (Build 24B83)");
    expect(report).toContain("Connected: yes");
    expect(report).toContain("Screen Recording: not allowed");
    expect(report).toContain("blocked apps: 1; blocked folders: 1");
    expect(report).toContain(
      "Calendar: on (allowed); Reminders: on (denied)",
    );
    // Names and paths the person chose stay on this Mac.
    expect(report).not.toContain("Secret App");
    expect(report).not.toContain("/Users/someone");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await mount(<HelpSettings signedIn />);
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Report a problem")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Computer use: on"),
    );
    expect(host!.textContent).toContain("Copied. Paste it into your report.");
    // WebKit: the clipboard takes the item during the click, and its text
    // arrives once the report is gathered.
    const items: { types: Record<string, Promise<Blob>> }[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public types: Record<string, Promise<Blob>>) {
          items.push(this);
        }
      },
    );
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write, writeText },
    });
    writeText.mockClear();
    await act(async () => {
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Report a problem")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const blob = await items[0].types["text/plain"];
    expect(await blob.text()).toContain("Computer use: on");
    vi.unstubAllGlobals();
  });
  it("names the Open Muse service only in builds that have one", async () => {
    const configured = vi
      .spyOn(backgroundClient, "configured")
      .mockReturnValue(true);
    await mount(<LegalSettings />);
    expect(host!.textContent).toContain(
      "the Open Muse service only keeps your account",
    );
    expect(host!.textContent).not.toContain("runs no service of its own");
    configured.mockRestore();
  });
  it("translates its copy and ships the notices", () => {
    for (const file of [
      "macos/ui/HelpSettings.tsx",
      "macos/ui/LegalSettings.tsx",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
    expect(readFileSync("scripts/build-macos.mjs", "utf8")).toContain(
      '"notices.txt"',
    );
    expect(readFileSync("macos/OpenMuse.swift", "utf8")).toContain(
      "window.__OPEN_MUSE_SYSTEM__ = ",
    );
  });
});
