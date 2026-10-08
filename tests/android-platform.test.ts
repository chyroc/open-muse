import { Capacitor } from "@capacitor/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { followAndroidTextScale } from "../src/dynamic-type";
import { reportReplying } from "../src/notifications";
import { personalSources } from "../src/personal";
import { appSurface } from "../src/platform";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Android app", () => {
  it("names itself and reads only the sources Android has", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    expect(appSurface()).toBe("android");
    expect(personalSources()).toEqual(["calendar", "contacts"]);
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    expect(appSurface()).toBe("iphone");
    expect(personalSources()).toEqual(["calendar", "reminders", "contacts"]);
  });
  it("sizes layout metrics from the system font size it hands the page", () => {
    const values = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
      },
    } as unknown as HTMLElement;
    followAndroidTextScale(root, 1.54);
    expect(values.get("--type-scale")).toBe("1.54");
    followAndroidTextScale(root, 9);
    expect(values.get("--type-scale")).toBe("3");
    values.clear();
    followAndroidTextScale(root, "large");
    expect(values.size).toBe(0);
  });
  it("tells the Android app while a reply is under way", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("webkit", {
      messageHandlers: { museReplying: { postMessage } },
    });
    reportReplying(true);
    reportReplying(false);
    expect(postMessage.mock.calls).toEqual([[true], [false]]);
    // The iPhone app has no such handler; nothing is sent.
    vi.stubGlobal("webkit", { messageHandlers: {} });
    expect(() => reportReplying(true)).not.toThrow();
  });
});
