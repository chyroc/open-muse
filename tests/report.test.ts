import { afterEach, describe, expect, it, vi } from "vitest";
import { reportText } from "../src/ReportSheet";
import { listenForShake, setShakeToReport, shakeToReport } from "../src/shake";
import { t } from "../shared/i18n";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Report a problem", () => {
  it("carries the description, areas, app version and system version only", () => {
    const text = reportText(
      "  The sidebar does not open.  ",
      ["Main chat", "Settings"],
      "iOS 27.0.1",
    );
    expect(text).toContain("The sidebar does not open.\n");
    expect(text).toContain("Area: Main chat, Settings");
    expect(text).toContain("System: iOS 27.0.1");
    expect(text).toMatch(/Version: /);
    expect(reportText("x", [], "")).toContain("Area: Not chosen");
    expect(reportText("x", [], "")).toContain("System: unknown");
  });

  it("opens from a shake until it is turned off", () => {
    vi.stubGlobal("localStorage", storage());
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const opened = vi.fn();
    const stop = listenForShake(opened);
    expect(shakeToReport()).toBe(true);
    target.dispatchEvent(new Event("muse-shake"));
    expect(opened).toHaveBeenCalledTimes(1);
    setShakeToReport(false);
    target.dispatchEvent(new Event("muse-shake"));
    expect(opened).toHaveBeenCalledTimes(1);
    stop();
  });

  it("is translated", () => {
    expect(t("What went wrong?", {}, "zh-CN")).toBe("哪儿出了问题？");
    expect(t("Shake iPhone to report a problem", {}, "zh-CN")).toBe(
      "摇晃手机来报告问题",
    );
    expect(t("Volcano Engine Privacy Policy", {}, "zh-CN")).toBe(
      "火山引擎隐私政策",
    );
  });
});
