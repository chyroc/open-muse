import { useCallback, useEffect, useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import type { DeviceRecord } from "../shared/devices";
import { backgroundClient } from "./background-client";
import { buildCommit } from "./build-info";
import { accountDevices, thisDeviceId, thisDeviceName } from "./devices";
import { Sheet } from "./MusePages";

// When a device was last seen, in the person's language.
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

const kind = (platform: DeviceRecord["platform"]) =>
  platform === "ios" ? "iPhone" : "Mac";

// This iPhone, then the account's other devices as the service last saw them.
// Removing a device only takes it off this list; it stays signed in.
export function DevicesSheet({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<DeviceRecord[]>();
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
    <Sheet title={t("Devices")} onClose={onClose} grouped>
      <h3 className="settings-group-title">{t("This device")}</h3>
      <ul className="settings-list">
        <li>
          <div className="settings-list-row">
            <span aria-hidden="true">
              <Smartphone size={22} strokeWidth={2} />
            </span>
            <span className="settings-row-text">
              {thisDeviceName("iPhone")}
              <small>
                iPhone · {t("Online")}
                {buildCommit ? ` · ${buildCommit}` : ""}
              </small>
            </span>
          </div>
        </li>
      </ul>
      <h3 className="settings-group-title">{t("Other devices")}</h3>
      <ul className="settings-list">
        {!account ? (
          <li>
            <p className="settings-list-note">
              {t(
                "Devices signed in to the same Open Muse account appear here. Without an account, each device keeps its own data.",
              )}
            </p>
          </li>
        ) : !devices && !error ? (
          <li>
            <p className="settings-list-note" role="status">
              {t("Loading devices")}
            </p>
          </li>
        ) : devices && !others.length ? (
          <li>
            <p className="settings-list-note">{t("No other devices yet.")}</p>
          </li>
        ) : (
          others.map((device) => {
            const Icon = device.platform === "ios" ? Smartphone : Laptop;
            return (
              <li key={device.id}>
                <div className="settings-list-row">
                  <span aria-hidden="true">
                    <Icon size={22} strokeWidth={2} />
                  </span>
                  <span className="settings-row-text">
                    {device.name}
                    <small>
                      {kind(device.platform)} · {lastSeen(device.last_seen_at)}
                      {` · ${device.app_version}`}
                    </small>
                  </span>
                  <button
                    className="settings-row-action danger"
                    aria-label={t("Remove {name}", { name: device.name })}
                    onClick={() => {
                      if (
                        !confirm(
                          t(
                            "Remove {name} from this list? It stays signed in and shows up again the next time it opens Open Muse.",
                            { name: device.name },
                          ),
                        )
                      )
                        return;
                      void backgroundClient
                        .forgetDevice(device.id)
                        .then(load)
                        .catch((failure: Error) => setError(failure.message));
                    }}
                  >
                    {t("Remove")}
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
      {error && (
        <p className="settings-footnote" role="alert">
          {error}
        </p>
      )}
      <p className="settings-footnote">
        {t(
          "Each device signs in on its own. This list only shows where your account is used.",
        )}
      </p>
    </Sheet>
  );
}
