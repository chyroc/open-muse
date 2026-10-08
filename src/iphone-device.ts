import { backgroundClient } from "./background-client";
import {
  accountDevices,
  registerThisDevice,
  shellVersion,
  thisDeviceName,
} from "./devices";
import { appSurface } from "./platform";
import { buildCommit } from "./build-info";

// In account builds the iPhone and Android apps show up in the account's
// device list, so the Mac's Settings can list them. They report at most
// hourly per account; the web build never reports.
const reportInterval = 60 * 60 * 1000;
let lastReport: { owner: string; at: number } | undefined;

export async function registerThisIPhone(now = Date.now()) {
  const surface = appSurface();
  if ((surface !== "iphone" && surface !== "android") || !accountDevices())
    return undefined;
  const owner = String(backgroundClient.accountOwner());
  if (lastReport?.owner === owner && now - lastReport.at < reportInterval)
    return undefined;
  lastReport = { owner, at: now };
  try {
    return await registerThisDevice(
      surface === "android" ? "android" : "ios",
      thisDeviceName(surface === "android" ? "Android" : "iPhone"),
      buildCommit || shellVersion(),
    );
  } catch {
    // Best-effort: a failure never interrupts the app; the next launch or
    // return to the foreground tries again.
    lastReport = undefined;
    return undefined;
  }
}
