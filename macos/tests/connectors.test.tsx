import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { ConnectorsSettings, connectors } from "../ui/ConnectorsSettings";

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
async function mount(onSection = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(<ConnectorsSettings onSection={onSection} />),
  );
  return onSection;
}
const button = (label: string) =>
  [...host!.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;

describe("Mac connectors", () => {
  it("filters by what is typed", async () => {
    await mount();
    const input = host!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "lark");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host!.querySelectorAll(".settings-device-row")).toHaveLength(1);
    expect(host!.textContent).toContain("Lark");
  });
  it("drafts the Lark sign-in in the main chat and opens Computer use settings", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    const onSection = await mount();
    await act(async () => button("Connect").click());
    expect(postMessage).toHaveBeenCalledWith({
      name: "draft",
      value: connectors().find((item) => item.id === "lark")!.connect,
    });
    expect(host!.textContent).toContain("A draft is waiting in the main chat.");
    await act(async () => button("Settings").click());
    expect(onSection).toHaveBeenCalledWith("computer-use");
  });
  it("translates every connector", () => {
    for (const item of connectors()) {
      expect(zhCN[item.name] ?? item.name).toBeTruthy();
      if (item.connect) expect(zhCN[item.connect], item.connect).toBeTruthy();
    }
    for (const [, key] of readFileSync(
      "macos/ui/ConnectorsSettings.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
});
