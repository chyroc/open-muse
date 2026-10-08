import { eventText, type AgentEvent } from "../shared/types";

// Settings > Notifications. Open Muse notifies when Upcoming reminders are due
// and when a reply finishes after the person left the app. Notifications are
// on unless the person turns them off here; iOS's own permission is asked the
// first time there is something to announce, or when they are turned on.

const key = "open-muse.notifications";

type NotificationsBridge = {
  postMessage: (
    body:
      | { operation: "status" | "authorize" }
      | { operation: "reply"; title: string; body: string },
  ) => Promise<unknown>;
};
const bridge = () =>
  (
    globalThis as unknown as {
      webkit?: {
        messageHandlers?: { museNotifications?: NotificationsBridge };
      };
    }
  ).webkit?.messageHandlers?.museNotifications;

export type NotificationAccess = "allowed" | "denied" | "not-asked";

export const notificationsSupported = () => Boolean(bridge());

export const notificationsEnabled = () =>
  globalThis.localStorage?.getItem(key) !== "off";

export function setNotificationsEnabled(enabled: boolean) {
  if (enabled) globalThis.localStorage?.removeItem(key);
  else globalThis.localStorage?.setItem(key, "off");
}

const access = (value: unknown): NotificationAccess =>
  value === "allowed" || value === "denied" ? value : "not-asked";

export async function notificationAccess() {
  const native = bridge();
  return native
    ? access(await native.postMessage({ operation: "status" }))
    : ("denied" as const);
}

export async function requestNotifications() {
  const native = bridge();
  return native
    ? access(await native.postMessage({ operation: "authorize" }))
    : ("denied" as const);
}

// The reply the person missed, as a short notification: who answered and the
// start of what they said.
export function replyNotice(events: readonly AgentEvent[], name: string) {
  // Only a reply to the person's latest message counts.
  let last: AgentEvent | undefined;
  for (const event of [...events].reverse()) {
    if (event.type === "user.message") break;
    if (event.type === "agent.message" && eventText(event).trim()) {
      last = event;
      break;
    }
  }
  if (!last) return undefined;
  const text = eventText(last)
    .replace(/[`*_#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: name,
    body: text.length > 200 ? `${text.slice(0, 199)}…` : text,
  };
}

type ReplyingBridge = { postMessage: (running: boolean) => unknown };

// Whether a reply is being written. The Android app keeps running for a
// short while after the person leaves it only while one is, so it can finish
// and be announced; iOS grants that time on its own and has no such handler.
export function reportReplying(running: boolean) {
  void (
    globalThis as unknown as {
      webkit?: { messageHandlers?: { museReplying?: ReplyingBridge } };
    }
  ).webkit?.messageHandlers?.museReplying?.postMessage(running);
}

// Announces a reply that finished while the app was in the background.
export function notifyReply(events: readonly AgentEvent[], name: string) {
  const native = bridge();
  const notice = replyNotice(events, name);
  if (!native || !notice || !notificationsEnabled()) return;
  void native.postMessage({ operation: "reply", ...notice }).catch(() => {});
}
