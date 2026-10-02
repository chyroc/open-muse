import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpcomingItem } from "../shared/upcoming";
import {
  announceReminders,
  notificationLimit,
  notificationPlan,
  reminderNotificationsSupported,
} from "../src/reminderNotifications";

const base = {
  instruction: "",
  time_zone: "Asia/Shanghai",
  status: "active",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
} as const;
const item = (
  id: string,
  schedule: UpcomingItem["schedule"],
  status: UpcomingItem["status"] = "active",
): UpcomingItem => ({ ...base, id, title: `Title ${id}`, schedule, status });
// Friday 2 October 2026, 20:00 in Shanghai.
const now = Date.parse("2026-10-02T12:00:00Z");

describe("Reminder notifications", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("plans the next week of active items, soonest first", () => {
    const plan = notificationPlan(
      [
        item("daily", { kind: "daily", time: "09:00" }),
        item("once", { kind: "once", at: "2026-10-02T12:40:00.000Z" }),
        item("paused", { kind: "daily", time: "08:00" }, "paused"),
        item("past", { kind: "once", at: "2026-10-02T11:00:00.000Z" }),
        item("later", { kind: "once", at: "2026-11-02T12:00:00.000Z" }),
      ],
      now,
    );
    expect(plan[0]).toEqual({
      id: `once-${Date.parse("2026-10-02T12:40:00Z")}`,
      title: "Title once",
      at: Date.parse("2026-10-02T12:40:00Z"),
    });
    const daily = plan.filter((entry) => entry.title === "Title daily");
    expect(daily).toHaveLength(7);
    expect(daily[0].at).toBe(Date.parse("2026-10-03T01:00:00Z"));
    expect(plan.map((entry) => entry.title)).not.toContain("Title paused");
    expect(plan.map((entry) => entry.title)).not.toContain("Title past");
    expect(plan.map((entry) => entry.title)).not.toContain("Title later");
    expect(plan.map((entry) => entry.at)).toEqual(
      [...plan.map((entry) => entry.at)].sort((a, b) => a - b),
    );
  });
  it("keeps within the pending-notification limit", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      item(`d${index}`, { kind: "daily", time: `0${index}:30` }),
    );
    expect(notificationPlan(many, now)).toHaveLength(notificationLimit);
  });
  it("hands the plan to the native bridge, and does nothing without one", () => {
    expect(reminderNotificationsSupported()).toBe(false);
    expect(() => announceReminders([])).not.toThrow();
    const postMessage = vi.fn();
    vi.stubGlobal("webkit", {
      messageHandlers: { museReminders: { postMessage } },
    });
    expect(reminderNotificationsSupported()).toBe(true);
    announceReminders(
      [item("once", { kind: "once", at: "2026-10-02T12:40:00.000Z" })],
      now,
    );
    expect(postMessage).toHaveBeenCalledWith({
      items: [expect.objectContaining({ title: "Title once" })],
    });
    announceReminders([], now);
    expect(postMessage).toHaveBeenLastCalledWith({ items: [] });
  });
});
