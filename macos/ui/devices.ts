import { uuid } from "../../shared/crypto";
import { deviceRegistration } from "../../shared/devices";
import { backgroundClient } from "../../src/background-client";
import { appVersion } from "./settings";

// This Mac's identity in the account's device list: a random id kept on this
// device, its own computer name, and the app version. Presence only.
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
export function thisDeviceName() {
  const value = (
    window as unknown as { __OPEN_MUSE_DEVICE__?: { name?: unknown } }
  ).__OPEN_MUSE_DEVICE__?.name;
  const name =
    typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  return (name || "Mac").slice(0, 80);
}
export function accountDevices() {
  return (
    backgroundClient.accountConfigured() &&
    Boolean(backgroundClient.accountOwner())
  );
}
// Registering is best-effort: a failure never interrupts the workspace.
export async function registerThisMac() {
  const id = thisDeviceId();
  if (!id || !accountDevices()) return undefined;
  const input = deviceRegistration.safeParse({
    name: thisDeviceName(),
    platform: "mac",
    app_version: appVersion().replace(/[^0-9A-Za-z.+-]/g, "") || "0",
  });
  if (!input.success) return undefined;
  return backgroundClient.registerDevice(id, input.data);
}
