import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatLocale, t } from "../../shared/i18n";
import type { DeviceRecord } from "../../shared/devices";
import { backgroundClient } from "../../src/background-client";
import { accountDevices, thisDeviceId, thisDeviceName } from "./devices";

export function lastSeen(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 2) return t("Online");
  const format = new Intl.RelativeTimeFormat(formatLocale(), {
    numeric: "auto",
  });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

// This Mac, and in account builds the account's other devices as the service
// last saw them. Forgetting a device only removes it from this list.
export function DevicesSettings() {
  const [devices, setDevices] = useState<DeviceRecord[]>();
  const [forget, setForget] = useState<string>();
  // The device being removed, while the service answers, and the one leaving
  // the list once it has.
  const [removing, setRemoving] = useState<string>();
  const [leaving, setLeaving] = useState<string>();
  const remove = (device: string) => {
    if (removing) return;
    setRemoving(device);
    setError("");
    void backgroundClient
      .forgetDevice(device)
      .then(() => {
        setLeaving(device);
        // The row fades and folds away before the list is read again.
        return new Promise((resolve) => setTimeout(resolve, 220));
      })
      .then(load)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => {
        setRemoving(undefined);
        setLeaving(undefined);
        setForget(undefined);
      });
  };
  const [error, setError] = useState("");
  const account = accountDevices();
  const id = thisDeviceId();
  const load = useCallback(() => {
    if (!account) return;
    void backgroundClient
      .devices()
      .then(setDevices)
      .catch((failure: Error) => setError(failure.message));
  }, [account]);
  useEffect(load, [load]);
  const others = (devices ?? []).filter((device) => device.id !== id);
  return (
    <>
      <h2>{t("This device")}</h2>
      <div className="settings-group">
        <div className="settings-row settings-device-row">
          <div>
            <strong>{thisDeviceName()}</strong>
            <p>{t("Online")}</p>
          </div>
        </div>
      </div>
      <h2>{t("Other devices")}</h2>
      <div className="settings-group">
        {!account ? (
          <div className="settings-row">
            <div>
              <p>
                {t(
                  "Devices signed in to the same Open Muse account appear here. Without an account, each device keeps its own data.",
                )}
              </p>
            </div>
          </div>
        ) : !devices && !error ? (
          // Placeholder rows hold the layout while the list loads.
          <div
            className="settings-skeleton"
            role="status"
            aria-label={t("Loading devices")}
          >
            <span />
            <span />
          </div>
        ) : devices && !others.length ? (
          <div className="settings-row">
            <div>
              <p>{t("No other devices yet.")}</p>
            </div>
          </div>
        ) : (
          others.map((device) => (
            <div
              className={`settings-row settings-device-row${leaving === device.id ? " leaving" : ""}`}
              key={device.id}
            >
              <div>
                <strong>{device.name}</strong>
                <p>
                  {device.platform === "ios" ? "iPhone" : "Mac"} ·{" "}
                  {lastSeen(device.last_seen_at)}
                </p>
              </div>
              {forget === device.id ? (
                <button
                  className="settings-inline-button danger"
                  disabled={removing === device.id}
                  aria-busy={removing === device.id}
                  onClick={() => remove(device.id)}
                >
                  {removing === device.id ? (
                    <>
                      <LoaderCircle
                        size={13}
                        className="spin"
                        aria-hidden="true"
                      />
                      {t("Removing…")}
                    </>
                  ) : (
                    t("Confirm")
                  )}
                </button>
              ) : (
                <button
                  className="settings-inline-button"
                  disabled={Boolean(removing)}
                  onClick={() => setForget(device.id)}
                >
                  {t("Forget")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
