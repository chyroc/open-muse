import { t } from "../../shared/i18n";
import {
  backgroundCredentials,
  credentials,
  type CredentialStore,
} from "./storage";

const knownDatabases = ["open-muse-direct-v1"];

// Returns this device to first launch: saved logins are removed from secure
// storage, and every local database and preference is deleted. Nothing in the
// cloud changes: MA agents, conversations, memory, and the account remain.
// Callers reload the app afterwards so no in-memory state survives.
export async function resetDevice(
  vaults: CredentialStore[] = [credentials, backgroundCredentials],
) {
  const failures: unknown[] = [];
  for (const vault of vaults)
    await vault.write("").catch((error) => failures.push(error));
  const names = new Set(knownDatabases);
  const factory = globalThis.indexedDB as
    (IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> }) | undefined;
  if (factory?.databases)
    for (const info of await factory.databases().catch(() => []))
      if (info.name) names.add(info.name);
  if (factory)
    for (const name of names)
      await deleteDatabase(factory, name).catch((error) =>
        failures.push(error),
      );
  for (const storage of [
    globalThis.localStorage,
    globalThis.sessionStorage,
  ] as (Storage | undefined)[])
    try {
      storage?.clear();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length)
    throw new Error(
      t(
        "Some data on this device could not be removed. Close other Open Muse windows, unlock the device, and try again.",
      ),
    );
}

// Open connections close themselves on a version change; another window that
// keeps one open blocks deletion, which is reported instead of waiting forever.
function deleteDatabase(factory: IDBFactory, name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    const timer = setTimeout(
      () => reject(new Error(`Deleting ${name} is blocked`)),
      5000,
    );
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
  });
}
