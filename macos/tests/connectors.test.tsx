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
            url: "https://open.feishu.cn/page/cli?user_code=A",
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
    const { onSection, service } = await mount();
    await act(async () => button("Connect").click());
    const link = () => host!.querySelector<HTMLAnchorElement>(".lark-setup a")!;
    expect(link().textContent).toBe("Open Lark to choose the app");
    expect(link().href).toContain("open.feishu.cn");
    // Back from the Lark page: the next step shows at once.
    service.advance("user");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(link().textContent).toBe("Open Lark to approve");
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
});
