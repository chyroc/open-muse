import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { HelpSettings } from "../ui/HelpSettings";
import { LegalSettings } from "../ui/LegalSettings";
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
  it("explains notices are missing outside the app bundle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await mount(<LegalSettings />);
    await act(async () => host!.querySelector("button")!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host!.textContent).toContain("only included in the Mac app bundle");
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
  });
});
