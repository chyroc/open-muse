import { describe, expect, it } from "vitest";
import { localTime, turnContext } from "../shared/turn-context";

describe("Turn context", () => {
  const now = new Date("2026-10-02T12:17:00Z");
  it("states the local time with its zone and offset", () => {
    expect(localTime(now, "Asia/Shanghai")).toBe(
      "Friday, October 2, 2026, 20:17 (Asia/Shanghai, GMT+08:00)",
    );
    expect(localTime(now, "America/Los_Angeles")).toBe(
      "Friday, October 2, 2026, 05:17 (America/Los_Angeles, GMT-07:00)",
    );
    expect(localTime(now, "UTC")).toBe(
      "Friday, October 2, 2026, 12:17 (UTC, GMT+00:00)",
    );
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(localTime(now, "Not/AZone")).toContain("(UTC, GMT+00:00)");
  });
  it("names the app and which device tools it can answer", () => {
    const iphone = turnContext(now, "Asia/Shanghai", "iphone");
    expect(iphone).toMatch(/^<open-muse-context>\n/);
    expect(iphone).toMatch(/\n<\/open-muse-context>$/);
    expect(iphone).toContain("iPhone app, which answers health_read");
    expect(iphone).toContain(
      "only when the person asks for something on their Mac",
    );
    expect(turnContext(now, "UTC", "mac")).toContain(
      "Mac app, which answers the mac_* tools",
    );
    expect(turnContext(now, "UTC", "web")).toContain("web app");
  });
});
