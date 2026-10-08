import { readFileSync } from "node:fs";
import { Capacitor } from "@capacitor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundClient } from "../src/background-client";
import { thisDeviceId, thisDeviceName } from "../src/devices";
import { registerThisIPhone } from "../src/iphone-device";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  };
}
let storage = memoryStorage();
let owner = 0;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function iphone() {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
}
// A fresh account for each case, so earlier reports do not throttle it.
function signedIn() {
  owner += 1;
  vi.spyOn(backgroundClient, "accountConfigured").mockReturnValue(true);
  vi.spyOn(backgroundClient, "accountOwner").mockReturnValue(
    `muse_user_${owner}` as never,
  );
}

describe("iPhone device registration", () => {
  it("keeps one random id across launches", () => {
    const id = thisDeviceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(thisDeviceId()).toBe(id);
    expect(storage.getItem("muse.device.id")).toBe(id);
  });
  it("uses the shell's name on one line, or a fallback", () => {
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: " My\r\niPhone " });
    expect(thisDeviceName("iPhone")).toBe("My iPhone");
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: 7 });
    expect(thisDeviceName("iPhone")).toBe("iPhone");
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: "x".repeat(120) });
    expect(thisDeviceName("iPhone")).toHaveLength(80);
  });
  it("registers once while signed in on the iPhone", async () => {
    iphone();
    signedIn();
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: "iPhone" });
    vi.stubGlobal("__OPEN_MUSE_VERSION__", "0.2.0");
    const register = vi
      .spyOn(backgroundClient, "registerDevice")
      .mockResolvedValue({} as never);
    const now = Date.now();
    await registerThisIPhone(now);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(thisDeviceId(), {
      name: "iPhone",
      platform: "ios",
      app_version: "0.2.0",
    });
    // Returning to the foreground soon after does not report again.
    await registerThisIPhone(now + 60_000);
    expect(register).toHaveBeenCalledTimes(1);
    // An hour later, or under another account, it reports again.
    await registerThisIPhone(now + 61 * 60_000);
    expect(register).toHaveBeenCalledTimes(2);
    signedIn();
    await registerThisIPhone(now + 62 * 60_000);
    expect(register).toHaveBeenCalledTimes(3);
  });
  it("reuses the stored id on a later launch", async () => {
    iphone();
    signedIn();
    const id = thisDeviceId();
    const register = vi
      .spyOn(backgroundClient, "registerDevice")
      .mockResolvedValue({} as never);
    await registerThisIPhone();
    expect(register.mock.calls[0]?.[0]).toBe(id);
    expect(register.mock.calls[0]?.[1]).toMatchObject({
      name: "iPhone",
      app_version: "0",
    });
  });
  it("registers the Android app as an Android phone", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    signedIn();
    vi.stubGlobal("__OPEN_MUSE_DEVICE__", { name: "Pixel 10a" });
    vi.stubGlobal("__OPEN_MUSE_VERSION__", "0.2.0");
    const register = vi
      .spyOn(backgroundClient, "registerDevice")
      .mockResolvedValue({} as never);
    await registerThisIPhone();
    expect(register).toHaveBeenCalledWith(thisDeviceId(), {
      name: "Pixel 10a",
      platform: "android",
      app_version: "0.2.0",
    });
  });
  it("does nothing on the web or when signed out", async () => {
    const register = vi.spyOn(backgroundClient, "registerDevice");
    signedIn();
    const platform = vi.spyOn(Capacitor, "getPlatform");
    platform.mockReturnValue("web");
    expect(await registerThisIPhone()).toBeUndefined();
    platform.mockReturnValue("ios");
    vi.spyOn(backgroundClient, "accountOwner").mockReturnValue(undefined);
    expect(await registerThisIPhone()).toBeUndefined();
    vi.spyOn(backgroundClient, "accountConfigured").mockReturnValue(false);
    expect(await registerThisIPhone()).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });
  it("swallows a failure and tries again next time", async () => {
    iphone();
    signedIn();
    const register = vi
      .spyOn(backgroundClient, "registerDevice")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({} as never);
    const now = Date.now();
    await expect(registerThisIPhone(now)).resolves.toBeUndefined();
    await registerThisIPhone(now + 1000);
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("keeps the native contract", () => {
    const shell = readFileSync("ios/App/App/SceneDelegate.swift", "utf8");
    expect(shell).toContain("window.__OPEN_MUSE_DEVICE__");
    expect(shell).toContain("UIDevice.current.name");
    expect(shell).toContain("window.__OPEN_MUSE_VERSION__");
  });
});
