import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notificationsEnabled,
  notifyReply,
  replyNotice,
  setNotificationsEnabled,
} from "../src/notifications";
import { announceReminders } from "../src/reminderNotifications";
import type { AgentEvent } from "../shared/types";
import type { UpcomingItem } from "../shared/upcoming";
import { t } from "../shared/i18n";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
const message = (
  id: string,
  type: "user.message" | "agent.message",
  text: string,
): AgentEvent => ({ id, type, content: [{ type: "text", text }] });

afterEach(() => vi.unstubAllGlobals());

describe("Notifications", () => {
  it("names the companion and starts with its reply to the latest message", () => {
    const events = [
      message("1", "user.message", "first"),
      message("2", "agent.message", "an older answer"),
      message("3", "user.message", "how was my run?"),
      message("4", "agent.message", "**Great** run:\n\n- 5 km in 28 min"),
    ];
    expect(replyNotice(events, "Kit")).toEqual({
      title: "Kit",
      body: "Great run: - 5 km in 28 min",
    });
    // No reply yet to the latest message: nothing to announce.
    expect(replyNotice(events.slice(0, 3), "Kit")).toBeUndefined();
    expect(
      replyNotice([message("5", "agent.message", "x".repeat(400))], "Kit")!
        .body,
    ).toHaveLength(200);
  });

  it("stay on until turned off, and then announce nothing", () => {
    vi.stubGlobal("localStorage", storage());
    const reply = vi.fn(async () => true);
    const reminders = vi.fn();
    vi.stubGlobal("webkit", {
      messageHandlers: {
        museNotifications: { postMessage: reply },
        museReminders: { postMessage: reminders },
      },
    });
    const events = [
      message("1", "user.message", "hi"),
      message("2", "agent.message", "hello"),
    ];
    const item: UpcomingItem = {
      id: "standup",
      title: "Stand-up",
      instruction: "",
      time_zone: "Asia/Shanghai",
      status: "active",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
      schedule: {
        kind: "once",
        at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    };
    expect(notificationsEnabled()).toBe(true);
    notifyReply(events, "Kit");
    expect(reply).toHaveBeenCalledWith({
      operation: "reply",
      title: "Kit",
      body: "hello",
    });
    announceReminders([item]);
    expect(reminders.mock.lastCall?.[0].items.length).toBeGreaterThan(0);

    setNotificationsEnabled(false);
    notifyReply(events, "Kit");
    expect(reply).toHaveBeenCalledTimes(1);
    announceReminders([item]);
    expect(reminders).toHaveBeenLastCalledWith({ items: [] });
    setNotificationsEnabled(true);
    expect(notificationsEnabled()).toBe(true);
  });

  it("is translated", () => {
    expect(t("Allow notifications", {}, "zh-CN")).toBe("允许通知");
    expect(t("Notifications", {}, "zh-CN")).toBe("通知");
  });
});
