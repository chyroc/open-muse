import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { backgroundClient } from "../../src/background-client";
import { DevicesSettings, lastSeen } from "../ui/DevicesSettings";
import { registerThisMac, thisDeviceId, thisDeviceName } from "../ui/devices";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DevicesSettings />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
function account() {
  vi.spyOn(backgroundClient, "accountConfigured").mockReturnValue(true);
  vi.spyOn(backgroundClient, "accountOwner").mockReturnValue(
    "muse_user_a" as never,
  );
}

describe("Mac devices", () => {
  it("keeps one random id and the Mac's own name", () => {
    const id = thisDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(thisDeviceId()).toBe(id);
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: "Studio\nMac" });
    expect(thisDeviceName()).toBe("Studio Mac");
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", undefined);
    expect(thisDeviceName()).toBe("Mac");
  });
  it("describes how recently a device was seen", () => {
    const now = Date.now();
    expect(lastSeen(now - 30_000, now)).toBe("Online");
    expect(lastSeen(now - 3 * 3600_000, now)).toBe("3 hours ago");
    expect(lastSeen(now - 3 * 86400_000, now)).toBe("3 days ago");
  });
  it("registers only in account builds", async () => {
    const register = vi.spyOn(backgroundClient, "registerDevice");
    vi.spyOn(backgroundClient, "accountConfigured").mockReturnValue(false);
    expect(await registerThisMac()).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
    account();
    register.mockResolvedValue({} as never);
    await registerThisMac();
    expect(register).toHaveBeenCalledWith(thisDeviceId(), {
      name: "Mac",
      platform: "mac",
      app_version: expect.any(String),
    });
  });
  it("shows only this Mac without an account", async () => {
    vi.spyOn(backgroundClient, "accountConfigured").mockReturnValue(false);
    await mount();
    expect(host!.textContent).toContain("Online");
    expect(host!.textContent).toContain("same Open Muse account");
  });
  it("lists the account's other devices and forgets one after confirming", async () => {
    account();
    const self = thisDeviceId()!;
    const iphone = {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Phone",
      platform: "ios" as const,
      app_version: "9",
      last_seen_at: Date.now() - 2 * 3600_000,
    };
    const list = vi
      .spyOn(backgroundClient, "devices")
      .mockResolvedValue([
        { ...iphone, id: self, name: "This one", platform: "mac" },
        iphone,
      ]);
    const forget = vi
      .spyOn(backgroundClient, "forgetDevice")
      .mockResolvedValue({ ok: true });
    await mount();
    expect(host!.textContent).not.toContain("This one");
    expect(host!.textContent).toContain("Phone");
    expect(host!.textContent).toContain("iPhone · 2 hours ago");
    const button = (label: string) =>
      [...host!.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      )!;
    await act(async () => button("Forget").click());
    expect(forget).not.toHaveBeenCalled();
    list.mockResolvedValue([]);
    await act(async () => button("Confirm").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(forget).toHaveBeenCalledWith(iphone.id);
    // The row says it is going, then folds away before the list reloads.
    expect(host!.querySelector(".settings-device-row.leaving")).toBeTruthy();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)));
    expect(host!.textContent).toContain("No other devices yet.");
  });
  it("translates its copy and keeps the native contract", () => {
    for (const [, key] of readFileSync(
      "macos/ui/DevicesSettings.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
    expect(readFileSync("macos/OpenMuse.swift", "utf8")).toContain(
      "window.__OPEN_MUSE_DEVICE__",
    );
  });
});
