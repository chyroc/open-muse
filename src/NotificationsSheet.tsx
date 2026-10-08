import { useEffect, useState } from "react";
import { t } from "../shared/i18n";
import { onAndroid } from "./platform";
import type { Client } from "./api";
import { Sheet } from "./MusePages";
import {
  notificationAccess,
  notificationsEnabled,
  requestNotifications,
  setNotificationsEnabled,
  type NotificationAccess,
} from "./notifications";
import { announceReminders } from "./reminderNotifications";

// Settings > Notifications: one switch for everything Open Muse announces on
// this iPhone. Turning it on asks iOS the first time; when iOS has refused,
// the switch stays off and points to iOS Settings.
export function NotificationsSheet({
  client,
  onClose,
}: {
  client: Pick<Client, "upcoming">;
  onClose: () => void;
}) {
  const [access, setAccess] = useState<NotificationAccess>();
  const [enabled, setEnabled] = useState(notificationsEnabled);
  useEffect(() => {
    void notificationAccess().then(setAccess, () => setAccess("denied"));
  }, []);
  // Reminders follow the switch at once.
  const reannounce = () =>
    void client.upcoming().then(
      ({ items }) => announceReminders(items),
      () => {},
    );
  async function toggle(on: boolean) {
    setNotificationsEnabled(on);
    setEnabled(on);
    if (on && access === "not-asked") setAccess(await requestNotifications());
    reannounce();
  }
  const denied = access === "denied";
  return (
    <Sheet title={t("Notifications")} onClose={onClose} grouped>
      <div className="settings-switch-section">
        <label className="settings-switch-row">
          <span>{t("Allow notifications")}</span>
          <input
            type="checkbox"
            role="switch"
            className="ios-switch"
            checked={enabled && !denied}
            disabled={access === undefined || denied}
            onChange={(event) => void toggle(event.target.checked)}
          />
        </label>
        <p className="settings-footnote">
          {t(
            "Get notified when your assistant replies after you leave the app, and when an Upcoming reminder is due.",
          )}
        </p>
        {denied && (
          <p className="settings-footnote">
            {onAndroid()
              ? t("Notifications are off for Open Muse in Android.")
              : t("Notifications are off for Open Muse in iOS.")}{" "}
            <a href="app-settings:" target="_blank" rel="noopener noreferrer">
              {t("Open Settings")}
            </a>
          </p>
        )}
      </div>
    </Sheet>
  );
}
