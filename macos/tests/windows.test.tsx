import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forPlatform,
  keysLabel,
  primaryModifier,
} from "../../shared/desktop-platform";
import { carbon, shortcutLabel } from "../ui/shortcut";
import { ComputerSettings } from "../ui/ComputerSettings";
import { activityLabel } from "../ui/model";

type Globals = { __OPEN_MUSE_PLATFORM__?: string };
const onWindows = () =>
  ((globalThis as Globals).__OPEN_MUSE_PLATFORM__ = "windows");

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  delete (globalThis as Globals).__OPEN_MUSE_PLATFORM__;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});

describe("Windows app wording and keys", () => {
  it("writes app shortcuts the Windows way only on Windows", () => {
    expect(keysLabel("⌘K")).toBe("⌘K");
    expect(forPlatform("Mac", "PC")).toBe("Mac");
    expect(primaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    onWindows();
    expect(keysLabel("⌘K")).toBe("Ctrl+K");
    expect(keysLabel("⇧⎋")).toBe("Shift+Esc");
    expect(keysLabel("⇧↩")).toBe("Shift+Enter");
    expect(keysLabel("⌘,")).toBe("Ctrl+,");
    expect(forPlatform("Mac", "PC")).toBe("PC");
    expect(primaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
    expect(primaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("labels global shortcuts with Windows key names, Command as Win", () => {
    const quick = { code: 49, modifiers: carbon.control | carbon.option };
    expect(shortcutLabel(quick)).toBe("⌃⌥Space");
    onWindows();
    expect(shortcutLabel(quick)).toBe("Ctrl+Alt+Space");
    expect(
      shortcutLabel({ code: 36, modifiers: carbon.command | carbon.shift }),
    ).toBe("Shift+Win+Enter");
  });

  it("names the PC in tool activity", () => {
    expect(activityLabel("mac_action")).toBe("Use your Mac");
    onWindows();
    expect(activityLabel("mac_action")).toBe("Use your PC");
    expect(activityLabel("mac_open")).toBe("Open on your PC");
  });

  it("shows no macOS permissions in Computer use on Windows", async () => {
    onWindows();
    const state = {
      enabled: false,
      accessibility: true,
      screen: true,
      keepAwake: false,
      blocked: [],
      fullDiskAccess: false,
      blockedFolders: [],
    };
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          museComputer: { postMessage: vi.fn(async () => state) },
        },
      },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<ComputerSettings />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(host.textContent).not.toContain("Permissions required");
    expect(host.textContent).not.toContain("System Settings");
    expect(host.textContent).toContain("Let your assistant use this PC");
  });
});
