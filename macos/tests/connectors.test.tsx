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
// The Open Muse service's Lark setup, moving through its steps on demand.
function larkService() {
  let phase: "none" | "app" | "user" | "connected" = "none";
  const status = () =>
    phase === "connected"
      ? { phase, name: "Alice", scope: "" }
      : phase === "none"
        ? { phase }
        : {
            phase,
            url:
              phase === "app"
                ? "https://open.feishu.cn/page/cli?user_code=A"
                : "https://accounts.feishu.cn/oauth/v1/device/verify?user_code=U",
            expires_at: Date.now() + 60_000,
          };
  return {
    advance(next: typeof phase) {
      phase = next;
    },
    larkConnection: vi.fn(async () => status()),
    startLarkConnection: vi.fn(async () => {
      phase = "app";
      return status();
    }),
    removeLarkState: vi.fn(async () => {
      phase = "none";
      return { saved: false };
    }),
    resetLarkConnection: vi.fn(async () => {
      phase = "none";
      return { phase: "none" as const };
    }),
  };
}
async function mount(onSection = vi.fn(), service = larkService()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ConnectorsSettings
        onSection={onSection}
        name="Kit"
        service={service as never}
      />,
    ),
  );
  return { onSection, service };
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
  it("connects Lark in two steps through the service, then disconnects", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    const { onSection, service } = await mount();
    await act(async () => button("Connect").click());
    const opened = () =>
      postMessage.mock.calls
        .map(([body]) => body as { name: string; value: string })
        .filter((body) => body.name === "open-lark")
        .map((body) => body.value);
    const states = () =>
      [...host!.querySelectorAll(".lark-setup li")].map((item) =>
        item.getAttribute("data-state"),
      );
    // The app page opens by itself, and its step waits with a spinner.
    expect(opened()).toEqual(["https://open.feishu.cn/page/cli?user_code=A"]);
    expect(states()).toEqual(["active", null]);
    expect(host!.querySelector(".lark-setup li .spin")).toBeTruthy();
    // Back from the Lark page: the app step is done and the approval page
    // opens by itself.
    service.advance("user");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(states()).toEqual(["done", "active"]);
    expect(opened()).toHaveLength(2);
    expect(opened()[1]).toContain("accounts.feishu.cn");
    // With an app chosen but not approved, setup can start over.
    await act(async () => button("Clear Lark setup and start over").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(service.resetLarkConnection).toHaveBeenCalled();
    expect(states()).toEqual(["active", null]);
    expect(opened()).toHaveLength(3);
    service.advance("connected");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host!.querySelector(".lark-setup")).toBeNull();
    expect(host!.textContent).toContain("Connected as Alice.");
    await act(async () => button("Disconnect").click());
    expect(service.removeLarkState).toHaveBeenCalled();
    expect(button("Connect")).toBeTruthy();
    await act(async () => button("Settings").click());
    expect(onSection).toHaveBeenCalledWith("computer-use");
  });
  it("translates every connector", () => {
    for (const item of connectors()) {
      expect(zhCN[item.name] ?? item.name).toBeTruthy();
    }
    for (const [, key] of readFileSync(
      "macos/ui/ConnectorsSettings.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
  it("shows the installed apps' own icons and keeps a glyph otherwise", async () => {
    const icon = "data:image/png;base64,AAAA";
    const postMessage = vi.fn(async (body: { operation: string }) =>
      body.operation === "app-icons"
        ? { lark: icon, mac: icon, browser: "javascript:alert(1)" }
        : undefined,
    );
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museComputer: { postMessage } } },
    });
    await mount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const row = (name: string) =>
      [...host!.querySelectorAll(".connector-row")].find((item) =>
        item.textContent?.includes(name),
      )!;
    expect(row("Lark").querySelector("img")?.getAttribute("src")).toBe(icon);
    expect(row("This Mac").querySelector("img")?.getAttribute("src")).toBe(
      icon,
    );
    // Only image data is used; otherwise the app's bundled icon shows, and a
    // connector with no app keeps its glyph.
    expect(row("Browser").querySelector('img[src^="javascript"]')).toBeNull();
    expect(
      row("Browser").querySelector(".connector-app-icon.bundled img"),
    ).toBeTruthy();
    expect(
      row("Web search and pages").querySelector(".connector-tile svg"),
    ).toBeTruthy();
    expect(
      row("Apple Health").querySelector(".connector-app-icon.bundled img"),
    ).toBeTruthy();
  });
});
