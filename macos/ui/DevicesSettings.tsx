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
                  "Devices signed in to the same Muse account appear here. Without an account, each device keeps its own data.",
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
            <div className="settings-row settings-device-row" key={device.id}>
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
                  onClick={() =>
                    void backgroundClient
                      .forgetDevice(device.id)
                      .then(load)
                      .catch((failure: Error) => setError(failure.message))
                      .finally(() => setForget(undefined))
                  }
                >
                  {t("Confirm")}
                </button>
              ) : (
                <button
                  className="settings-inline-button"
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
