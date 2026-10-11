import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const surface = vi.hoisted(() => ({ value: "iphone" }));
const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/platform", () => ({ appSurface: () => surface.value }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: http }));

import {
  checkForUpdate,
  dismissUpdate,
  parseFeed,
  resetUpdateState,
  setAutomaticDownloads,
  startUpdate,
  updateState,
} from "../src/app-update";
import { UpdateNotice, UpdateRows } from "../src/UpdateNotice";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
const ios = {
  version: "0.2.0",
  build: 202610121200,
  url: "https://testflight.apple.com/join/ABCDEFGH",
};
const android = {
  version: "20261012-abcdef0",
  build: 600,
  size: 12_000_000,
  sha256: "a".repeat(64),
  url: "https://cn.getopenmuse.com/android/OpenMuse-20261012-abcdef0.apk",
};

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  http.get.mockReset();
  resetUpdateState();
});
afterEach(() => vi.unstubAllGlobals());

describe("App updates", () => {
  it("accepts only a well-formed feed", () => {
    expect(parseFeed(JSON.stringify(ios))).toEqual(ios);
    expect(parseFeed({ ...ios, url: "http://example.com/x" })).toBeUndefined();
    expect(parseFeed({ ...ios, build: "1" })).toBeUndefined();
    expect(parseFeed({ ...android, sha256: "short" })).toBeUndefined();
    expect(parseFeed("not json")).toBeUndefined();
  });

  it("does nothing outside a native build", async () => {
    surface.value = "iphone";
    expect((await checkForUpdate()).phase).toBe("idle");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("finds a newer TestFlight build, keeps automatic checks to every six hours, and opens TestFlight", async () => {
    surface.value = "iphone";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 202610111702);
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    http.get.mockResolvedValue({ status: 200, data: ios });
    const now = Date.UTC(2026, 9, 12, 8);
    expect((await checkForUpdate({ automatic: true, now })).phase).toBe(
      "available",
    );
    expect(http.get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://getopenmuse.com/download/ios.json",
      }),
    );
    // An hour later an automatic check does not ask again, even after a
    // relaunch, yet still knows about the update; one the person starts asks.
    resetUpdateState();
    expect(
      (await checkForUpdate({ automatic: true, now: now + 3_600_000 })).phase,
    ).toBe("available");
    expect(http.get).toHaveBeenCalledTimes(1);
    await checkForUpdate({ now: now + 3_600_000 });
    expect(http.get).toHaveBeenCalledTimes(2);
    const notice = renderToStaticMarkup(<UpdateNotice />);
    expect(notice).toContain("Update in TestFlight");
    // The marketing version does not change between builds; the build does.
    expect(notice).toContain("0.2.0 (202610121200)");
    await startUpdate();
    expect(assign).toHaveBeenCalledWith(ios.url);
    // Hidden for this release, the notice stays away.
    dismissUpdate();
    expect(renderToStaticMarkup(<UpdateNotice />)).toBe("");
  });

  it("is up to date when the feed names this build, and falls back to the mirror", async () => {
    surface.value = "iphone";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", ios.build);
    http.get
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify(ios) });
    expect((await checkForUpdate()).phase).toBe("current");
    expect(http.get).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: "https://cn.getopenmuse.com/download/ios.json",
      }),
    );
    expect(renderToStaticMarkup(<UpdateNotice />)).toBe("");
  });

  it("reports a failed check the person started, and stays quiet for an automatic one", async () => {
    surface.value = "android";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 588);
    http.get.mockRejectedValue(new Error("offline"));
    expect((await checkForUpdate({ automatic: true })).phase).toBe("idle");
    // A failed check does not hold back the next automatic one.
    await checkForUpdate({ automatic: true });
    expect(http.get).toHaveBeenCalledTimes(4);
    await checkForUpdate();
    expect(updateState()).toMatchObject({ phase: "failed", failure: "check" });
  });

  it("downloads an Android release on its own, then asks for install permission before installing", async () => {
    surface.value = "android";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 588);
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ready: true, build: 600 })
      .mockResolvedValueOnce({ permission: true })
      .mockResolvedValueOnce({ started: true });
    vi.stubGlobal("webkit", {
      messageHandlers: { museUpdate: { postMessage } },
    });
    http.get.mockResolvedValue({ status: 200, data: android });
    expect((await checkForUpdate({ automatic: true })).phase).toBe("ready");
    expect(postMessage).toHaveBeenCalledWith({
      operation: "download",
      url: android.url,
      size: android.size,
      sha256: android.sha256,
      build: android.build,
    });
    await startUpdate();
    expect(postMessage).toHaveBeenLastCalledWith({ operation: "install" });
    expect(updateState().permission).toBe(true);
    expect(renderToStaticMarkup(<UpdateNotice />)).toContain(
      "Allow Open Muse to install apps",
    );
    await startUpdate();
    expect(updateState()).toMatchObject({ phase: "ready", permission: false });
  });

  it("leaves the Android download to the person when automatic downloads are off", async () => {
    surface.value = "android";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 588);
    const postMessage = vi.fn().mockResolvedValue({ ready: true });
    vi.stubGlobal("webkit", {
      messageHandlers: { museUpdate: { postMessage } },
    });
    setAutomaticDownloads(false);
    http.get.mockResolvedValue({ status: 200, data: android });
    expect((await checkForUpdate({ automatic: true })).phase).toBe("available");
    expect(postMessage).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<UpdateNotice />)).toContain(
      "Download and install",
    );
  });

  it("shows About's update rows: the check, the action, and Android's switch", async () => {
    surface.value = "web";
    expect(renderToStaticMarkup(<UpdateRows />)).toBe("");
    surface.value = "iphone";
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 202610111702);
    let rows = renderToStaticMarkup(<UpdateRows />);
    expect(rows).toContain("Updates");
    expect(rows).toContain("Check now");
    expect(rows).not.toContain("Download updates automatically");
    http.get.mockResolvedValue({ status: 200, data: ios });
    await checkForUpdate();
    rows = renderToStaticMarkup(<UpdateRows />);
    expect(rows).toContain("Version 0.2.0 (202610121200) is available");
    expect(rows).toContain("Update in TestFlight");
    surface.value = "android";
    resetUpdateState();
    vi.stubGlobal("__OPEN_MUSE_BUILD__", 588);
    expect(renderToStaticMarkup(<UpdateRows />)).toContain(
      "Download updates automatically",
    );
  });
});
