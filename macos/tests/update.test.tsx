import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { parseUpdate, type UpdateState } from "../ui/update";
import { UpdateSettings } from "../ui/UpdateSettings";

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
  vi.unstubAllGlobals();
});

const base: UpdateState = {
  supported: true,
  phase: "current",
  automatic: true,
  installable: true,
  progress: 0,
  checkedAt: Date.parse("2026-10-09T08:00:00Z"),
};

function nativeShell(initial: UpdateState) {
  let state = { ...initial };
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "automatic")
      state = { ...state, automatic: body.value === "true" };
    if (body.operation === "check") state = { ...state, phase: "checking" };
    return state;
  });
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { museUpdate: { postMessage } } },
  });
  return postMessage;
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<UpdateSettings />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
function button(label: string) {
  const found = [...host!.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("Mac app updates", () => {
  it("accepts only a complete state from the shell", () => {
    expect(parseUpdate({ ...base, progress: 3, failure: "other" })).toEqual({
      ...base,
      progress: 1,
      failure: undefined,
      version: undefined,
      build: undefined,
    });
    expect(parseUpdate({ ...base, phase: "done" })).toBeUndefined();
    expect(parseUpdate({ ...base, supported: "yes" })).toBeUndefined();
    expect(parseUpdate(null)).toBeUndefined();
  });

  it("says outside a released app that this build does not update itself", async () => {
    await mount();
    expect(host!.textContent).toContain("This build doesn't update itself.");
    expect(host!.querySelector("button")).toBeNull();
    nativeShell({ ...base, supported: false });
    await act(async () => root!.unmount());
    root = createRoot(host!);
    await act(async () => root!.render(<UpdateSettings />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(host!.textContent).toContain("This build doesn't update itself.");
  });

  it("checks on request and turns automatic updates off", async () => {
    const post = nativeShell(base);
    await mount();
    expect(host!.textContent).toContain("Open Muse is up to date");
    expect(host!.textContent).toContain("Last checked");
    await act(async () => button("Check now").click());
    expect(post).toHaveBeenCalledWith({ operation: "check" });
    expect(host!.textContent).toContain("Checking for updates…");
    const toggle = host!.querySelector<HTMLInputElement>("input[role=switch]")!;
    expect(toggle.checked).toBe(true);
    await act(async () => toggle.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(post).toHaveBeenCalledWith({
      operation: "automatic",
      value: "false",
    });
    expect(toggle.checked).toBe(false);
  });

  it.each([
    [
      { phase: "available", version: "0.3.0", build: 600 },
      "Version 0.3.0 (600) is available",
      "Download and install",
      "download",
    ],
    [
      {
        phase: "available",
        version: "0.3.0",
        build: 600,
        installable: false,
      },
      "Move it to the Applications folder",
      "Download",
      "download",
    ],
    [
      { phase: "ready", version: "0.3.0", build: 600 },
      "It installs when you quit Open Muse.",
      "Restart to update",
      "restart",
    ],
    [
      { phase: "failed", failure: "check" },
      "Couldn't check for updates",
      "Try again",
      "check",
    ],
    [
      { phase: "failed", failure: "verify", version: "0.3.0", build: 600 },
      "couldn't be verified",
      "Try again",
      "download",
    ],
  ] as const)(
    "offers the next step for %o",
    async (extra, text, label, operation) => {
      const post = nativeShell({ ...base, ...extra });
      await mount();
      expect(host!.textContent).toContain(text);
      await act(async () => button(label).click());
      expect(post).toHaveBeenCalledWith({ operation });
    },
  );

  it("shows download progress", async () => {
    nativeShell({
      ...base,
      phase: "downloading",
      version: "0.3.0",
      progress: 0.42,
    });
    await mount();
    expect(host!.textContent).toContain("Downloading version 0.3.0…");
    expect(host!.textContent).toContain("42%");
    expect(
      host!.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow"),
    ).toBe("42");
  });

  it("follows the shell's events and renders in Chinese", async () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    const post = nativeShell({
      ...base,
      phase: "ready",
      version: "0.3.0",
      build: 600,
    });
    await mount();
    expect(host!.textContent).toContain(zhCN["Restart to update"]);
    expect(host!.textContent).toContain(zhCN["Update automatically"]);
    const reads = post.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("muse-update-changed"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(post.mock.calls.length).toBe(reads + 1);
  });

  it("translates every update string", () => {
    const source = readFileSync("macos/ui/UpdateSettings.tsx", "utf8");
    for (const [, key] of source.matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
    for (const file of ["en", "zh-Hans"]) {
      const strings = readFileSync(
        `macos/${file}.lproj/Localizable.strings`,
        "utf8",
      );
      expect(strings).toContain('"Check for Updates…" =');
      expect(strings).toContain('"Restart to Update" =');
    }
  });

  it("keeps the shell's update contract", () => {
    const swift = readFileSync("macos/Updater.swift", "utf8");
    const app = readFileSync("macos/OpenMuse.swift", "utf8");
    const build = readFileSync("scripts/build-macos.mjs", "utf8");
    expect(app).toContain('name: "museUpdate"');
    expect(app).toContain(
      "updater.installOnExit(relaunch: relaunchAfterUpdate)",
    );
    expect(build).toContain('"macos/Updater.swift"');
    // Only an update signed by this app's own Developer ID team, matching
    // the published digest and accepted by Gatekeeper, is installed.
    expect(swift).toContain('certificate leaf[subject.OU] = \\"\\(team)\\"');
    expect(swift).toContain("SHA256.hash(data: data)");
    expect(swift).toContain(
      '"/usr/sbin/spctl", ["--assess", "--type", "execute"',
    );
    expect(swift).toContain('host == "getopenmuse.com"');
  });
});
