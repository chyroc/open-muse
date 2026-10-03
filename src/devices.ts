import { uuid } from "../shared/crypto";
import { deviceRegistration, type DeviceRegistration } from "../shared/devices";
import { backgroundClient } from "./background-client";

// This device's identity in the account's device list: a random id kept on
// this device (never derived from hardware), the name the native shell
// reports, and the app version. Presence only.
const idKey = "muse.device.id";
export function thisDeviceId() {
  try {
    const stored = localStorage.getItem(idKey);
    if (stored && /^[0-9a-f-]{36}$/.test(stored)) return stored;
    const id = uuid().toLowerCase();
    localStorage.setItem(idKey, id);
    return id;
  } catch {
    return undefined;
  }
}

type ShellGlobals = {
  __OPEN_MUSE_DEVICE__?: { name?: unknown };
  __OPEN_MUSE_VERSION__?: unknown;
};
const shell = () => globalThis as unknown as ShellGlobals;

// The device name injected by the native shell, on one line.
export function thisDeviceName(fallback: string) {
  const value = shell().__OPEN_MUSE_DEVICE__?.name;
  const name =
    typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  return (name || fallback).slice(0, 80);
}

// The app version injected by the native shell, or "" outside one.
export function shellVersion() {
  const version = shell().__OPEN_MUSE_VERSION__;
  return typeof version === "string" && /^[\w.\- ()]{1,40}$/.test(version)
    ? version
    : "";
}

export function accountDevices() {
  return (
    backgroundClient.accountConfigured() &&
    Boolean(backgroundClient.accountOwner())
  );
}

// Reports this device to the signed-in account. Callers treat it as
// best-effort: a failure never interrupts the app.
export async function registerThisDevice(
  platform: DeviceRegistration["platform"],
  name: string,
  version: string,
) {
  const id = thisDeviceId();
  if (!id || !accountDevices()) return undefined;
  const input = deviceRegistration.safeParse({
    name,
    platform,
    app_version: version.replace(/[^0-9A-Za-z.+-]/g, "") || "0",
  });
  if (!input.success) return undefined;
  return backgroundClient.registerDevice(id, input.data);
}
