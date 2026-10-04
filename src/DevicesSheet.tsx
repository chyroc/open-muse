import { useCallback, useEffect, useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import { mergeDevices, type DeviceRecord } from "../shared/devices";
import { backgroundClient } from "./background-client";
import { buildCommit } from "./build-info";
import {
  accountDevices,
  shellVersion,
  thisDeviceId,
  thisDeviceName,
} from "./devices";
import { Sheet } from "./MusePages";
import { RowChevron } from "./SettingsHome";

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

// The system name and version from the iPhone app (WebKit's user agent
// reports a frozen one), or "" outside it.
export function shellSystem() {
  const value = (globalThis as { __OPEN_MUSE_SYSTEM__?: unknown })
    .__OPEN_MUSE_SYSTEM__;
  return typeof value === "string" && /^[\w. ]{1,40}$/.test(value) ? value : "";
}

type Shown = {
  name: string;
  platform: DeviceRecord["platform"];
  status: string;
  version: string;
  system?: string;
  // Other devices can be taken off the list; this one cannot.
  record?: DeviceRecord & { ids: string[] };
};

// This iPhone, then the account's other devices as the service last saw them,
// each opening its details. Removing a device only takes it off this list; it
// stays signed in.
export function DevicesSheet({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<DeviceRecord[]>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Shown>();
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
  const current: Shown = {
    name: thisDeviceName("iPhone"),
    platform: "ios",
    status: t("Online"),
    version: shellVersion() || buildCommit || "",
    system: shellSystem(),
  };
  const others: Shown[] = mergeDevices(devices ?? [])
    .filter((device) => !device.ids.includes(id ?? ""))
    .map((device) => ({
      name: device.name,
      platform: device.platform,
      status: lastSeen(device.last_seen_at),
      version: device.app_version,
      record: device,
    }));
  const remove = (device: DeviceRecord & { ids: string[] }) => {
    if (
      !confirm(
        t(
          "Remove {name} from this list? It stays signed in and shows up again the next time it opens Open Muse.",
          { name: device.name },
        ),
      )
    )
      return;
    // A merged Mac is forgotten under every id it signed in with, one after
    // another; a failure stops there and the list is read again.
    void device.ids
      .reduce<Promise<unknown>>(
        (previous, deviceId) =>
          previous.then(() => backgroundClient.forgetDevice(deviceId)),
        Promise.resolve(),
      )
      .then(() => {
        setOpen(undefined);
        load();
      })
      .catch((failure: Error) => {
        setError(failure.message);
        load();
      });
  };
  return (
    <Sheet title={t("Devices")} onClose={onClose} grouped>
      <h3 className="settings-group-title">{t("This device")}</h3>
      <ul className="settings-list">
        <DeviceRow device={current} onOpen={() => setOpen(current)} />
      </ul>
      <h3 className="settings-group-title">{t("Other devices")}</h3>
      <ul className="settings-list">
        {!account ? (
          <li>
            <p className="settings-list-note">
              {t(
                "Devices signed in to your Open Muse account appear here once you sign in.",
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
          others.map((device) => (
            <DeviceRow
              key={device.record!.id}
              device={device}
              onOpen={() => setOpen(device)}
            />
          ))
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
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(undefined)} grouped>
          <ul className="settings-list">
            <Detail label={t("Type")} value={kind(open.platform)} />
            <Detail label={t("Last seen")} value={open.status} />
            {open.system && <Detail label={t("System")} value={open.system} />}
            {open.version && (
              <Detail label={t("App version")} value={open.version} />
            )}
          </ul>
          {open.record && (
            <>
              <ul className="settings-list device-remove">
                <li>
                  <button
                    className="settings-list-row settings-destructive"
                    onClick={() => remove(open.record!)}
                  >
                    <span>{t("Remove from this list")}</span>
                  </button>
                </li>
              </ul>
              <p className="settings-footnote">
                {t(
                  "The device stays signed in and shows up again the next time it opens Open Muse.",
                )}
              </p>
            </>
          )}
        </Sheet>
      )}
    </Sheet>
  );
}

function DeviceRow({ device, onOpen }: { device: Shown; onOpen: () => void }) {
  const Icon = device.platform === "ios" ? Smartphone : Laptop;
  return (
    <li>
      <button className="settings-list-row" onClick={onOpen}>
        <span aria-hidden="true">
          <Icon size={22} strokeWidth={2} />
        </span>
        <span className="settings-row-text">
          {device.name}
          <small>
            {kind(device.platform)} · {device.status}
          </small>
        </span>
        <RowChevron />
      </button>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <div className="settings-list-row">
        <span className="settings-row-text">{label}</span>
        <span className="settings-row-value">{value}</span>
      </div>
    </li>
  );
}
