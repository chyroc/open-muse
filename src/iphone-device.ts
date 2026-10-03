import { backgroundClient } from "./background-client";
import {
  accountDevices,
  registerThisDevice,
  shellVersion,
  thisDeviceName,
} from "./devices";
import { appSurface } from "./platform";

// In account builds the iPhone app shows up in the account's device list, so
// the Mac's Settings can list it. It reports at most hourly per account; the
// web and Android builds never report.
const reportInterval = 60 * 60 * 1000;
let lastReport: { owner: string; at: number } | undefined;

export async function registerThisIPhone(now = Date.now()) {
  if (appSurface() !== "iphone" || !accountDevices()) return undefined;
  const owner = String(backgroundClient.accountOwner());
  if (lastReport?.owner === owner && now - lastReport.at < reportInterval)
    return undefined;
  lastReport = { owner, at: now };
  try {
    return await registerThisDevice(
      "ios",
      thisDeviceName("iPhone"),
      shellVersion(),
    );
  } catch {
    // Best-effort: a failure never interrupts the app; the next launch or
    // return to the foreground tries again.
    lastReport = undefined;
    return undefined;
  }
}
