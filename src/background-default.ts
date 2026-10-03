import type { Client } from "./api";
import { backgroundClient, type BackgroundClient } from "./background-client";

// Background work is on by default in account builds: once the account's key
// and workspace are ready, the app lets the Open Muse service use them and
// keeps a daily Feed scheduled, so there is nothing to set up. Each write is
// sent once; a failure waits for the next check, at most hourly per account.
const interval = 60 * 60 * 1000;
let last: { owner: string; at: number } | undefined;

export async function ensureBackgroundWork(
  client: Pick<
    Client,
    "backgroundConfiguration" | "accountCredentialRevision" | "signedIn"
  >,
  service: BackgroundClient = backgroundClient,
  now = Date.now(),
) {
  if (!service.configured() || !client.signedIn()) return false;
  if (!service.connected()) await service.restore();
  const owner = service.accountOwner();
  if (!owner || (last?.owner === owner && now - last.at < interval))
    return false;
  last = { owner, at: now };
  let { status } = await service.refresh();
  if (!status.credentialStorageReady || !status.backgroundReady) return false;
  if (!status.connection?.configured) {
    await service.syncConfiguration(client);
    ({ status } = await service.refresh());
  }
  if (!status.connection?.configured || status.schedule.enabled) return false;
  await service.saveSchedule({
    ...status.schedule,
    enabled: true,
    timezone:
      status.schedule.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    local_time: status.schedule.local_time || "08:00",
  });
  return true;
}

// For tests: forget when each account was last checked.
export function resetBackgroundDefault() {
  last = undefined;
}
