import { occurrences, type UpcomingItem } from "../shared/upcoming";
import { notificationsEnabled } from "./notifications";

// How far ahead, and how many, reminders are handed to the system to announce
// while Open Muse is closed. The plan is replaced whenever the app refreshes
// it, so a short horizon stays current; iOS keeps at most 64 pending.
const horizon = 7 * 24 * 60 * 60 * 1000;
export const notificationLimit = 48;

export type ReminderNotification = { id: string; title: string; at: number };

// The next occurrences of active items, soonest first.
export function notificationPlan(
  items: readonly UpcomingItem[],
  now: number,
): ReminderNotification[] {
  return items
    .filter((item) => item.status === "active")
    .flatMap((item) =>
      occurrences(item, now, now + horizon, 8).map((at) => ({
        id: `${item.id}-${at}`,
        title: item.title,
        at,
      })),
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, notificationLimit);
}

type Bridge = {
  postMessage: (body: { items: ReminderNotification[] }) => void;
};

function bridge() {
  return (
    globalThis as unknown as {
      webkit?: { messageHandlers?: { museReminders?: Bridge } };
    }
  ).webkit?.messageHandlers?.museReminders;
}

export const reminderNotificationsSupported = () => Boolean(bridge());

// Replaces the announced reminders; an empty list clears them, as on sign-out.
export function announceReminders(
  items: readonly UpcomingItem[],
  now = Date.now(),
) {
  // Turned off in Settings > Notifications, nothing is announced.
  bridge()?.postMessage({
    items: notificationsEnabled() ? notificationPlan(items, now) : [],
  });
}
