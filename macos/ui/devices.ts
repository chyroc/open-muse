import {
  accountDevices,
  registerThisDevice,
  thisDeviceId,
  thisDeviceName as deviceName,
} from "../../src/devices";
import { appVersion } from "./settings";

// This Mac's identity in the account's device list: a random id kept on this
// device, its own computer name, and the app version. Presence only.
export { accountDevices, thisDeviceId };
export function thisDeviceName() {
  return deviceName("Mac");
}
// Registering is best-effort: a failure never interrupts the workspace.
export function registerThisMac() {
  return registerThisDevice("mac", thisDeviceName(), appVersion());
}
