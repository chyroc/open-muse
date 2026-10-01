import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import {
  openLoginItems,
  presenceAvailable,
  presenceChanged,
  readPresence,
  writePresence,
  type Presence,
  type PresenceKey,
} from "./presence";
import { Switch } from "./SettingsSwitch";

// Run on startup, the menu bar icon and the floating button belong to the
// native shell. The switches show the state the shell reports back, never an
// optimistic guess, so a login item macOS is still holding reads as pending.
export function PresenceSettings() {
  const [presence, setPresence] = useState<Presence>();
  const [pending, setPending] = useState<PresenceKey>();
  const [error, setError] = useState("");
  const available = presenceAvailable();
  useEffect(() => {
    if (!available) return;
    let alive = true;
    const refresh = () =>
      void readPresence()
        .then((value) => alive && value && setPresence(value))
        .catch(() => alive && setError(t("Could not read the app settings.")));
    refresh();
    // The menu bar icon and the other window can change these too.
    window.addEventListener(presenceChanged, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener(presenceChanged, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [available]);
  if (!available)
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Desktop presence")}</strong>
            <p>
              {t(
                "Run on startup, the menu bar icon and the floating button are controlled by the Mac app.",
              )}
            </p>
          </div>
        </div>
      </div>
    );
  function change(key: PresenceKey, value: boolean) {
    setPending(key);
    setError("");
    void writePresence(key, value)
      .then((next) => next && setPresence(next))
      .catch(() => setError(t("Could not change the app settings.")))
      .finally(() => setPending(undefined));
  }
  const loading = !presence;
  return (
    <>
      <div className="settings-group">
        <Switch
          label={t("Run on startup")}
          detail={
            presence?.startup === "requires-approval"
              ? t("macOS is waiting for you to allow Open Muse in Login Items.")
              : presence?.startup === "unavailable"
                ? t("macOS did not accept this app as a login item.")
                : undefined
          }
          checked={
            presence?.startup === "enabled" ||
            presence?.startup === "requires-approval"
          }
          disabled={loading || pending !== undefined}
          onChange={(value) => change("startup", value)}
        />
        {presence?.startup === "requires-approval" && (
          <button className="settings-disclosure" onClick={openLoginItems}>
            <strong>{t("Open Login Items")}</strong>
          </button>
        )}
        <Switch
          label={t("Show in menu bar")}
          checked={presence?.menuBar ?? false}
          disabled={loading || pending !== undefined}
          onChange={(value) => change("menuBar", value)}
        />
        <Switch
          label={t("Show floating button")}
          detail={t(
            "When the window is closed, a small button stays on screen and reopens it.",
          )}
          checked={presence?.floatingButton ?? false}
          disabled={loading || pending !== undefined}
          onChange={(value) => change("floatingButton", value)}
        />
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
