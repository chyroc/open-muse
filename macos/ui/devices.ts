import {
  accountDevices,
  registerThisDevice,
  thisDeviceId,
  thisDeviceName as deviceName,
} from "../../src/devices";
import { desktopPlatform } from "../../shared/desktop-platform";
import { appVersion } from "./settings";

// This computer's identity in the account's device list: a random id kept on
// this device, its own computer name, and the app version. Presence only.
export { accountDevices, thisDeviceId };
export function thisDeviceName() {
  return deviceName(desktopPlatform() === "windows" ? "Windows PC" : "Mac");
}
// Registering is best-effort: a failure never interrupts the workspace.
export function registerThisComputer() {
  return registerThisDevice(desktopPlatform(), thisDeviceName(), appVersion());
}
