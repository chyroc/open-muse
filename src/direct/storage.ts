import { t } from "../../shared/i18n";
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface CredentialStore {
  read(): Promise<string>;
  write(value: string): Promise<void>;
}
const android = registerPlugin<{
  read(input?: { namespace?: string }): Promise<{ value: string }>;
  write(input: { value: string; namespace?: string }): Promise<void>;
}>("MuseCredentials");
const credentialKey = "muse.direct.credentials.v1";
export const backgroundCredentials: CredentialStore = {
  read: () => vault("read", "", "background") as Promise<string>,
  write: async (value) => {
    await vault("write", value, "background");
  },
};
export const credentials: CredentialStore = {
  async read() {
    return vault("read") as Promise<string>;
  },
  async write(value) {
    await vault("write", value);
  },
};
async function vault(
  operation: "read" | "write",
  value = "",
  namespace: "direct" | "background" = "direct",
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bridge = (
      globalThis as unknown as {
        webkit?: {
          messageHandlers?: {
            museCredentials?: { postMessage(input: object): Promise<unknown> };
          };
        };
      }
    ).webkit?.messageHandlers?.museCredentials;
    let request: Promise<unknown>;
    if (bridge)
      request = bridge.postMessage({
        operation,
        value,
        ...(namespace === "background" ? { namespace } : {}),
      });
    else if (Capacitor.getPlatform() === "android") {
      // Android keeps both namespaces in Keystore-backed storage, like iOS.
      request =
        operation === "read"
          ? android.read({ namespace }).then((r) => r.value)
          : android.write({ value, namespace });
    } else if (Capacitor.isNativePlatform())
      throw new Error(t("Missing secure storage bridge"));
    else {
      // Web credentials never go to localStorage, IndexedDB, caches, or a server.
      const key =
        namespace === "background"
          ? "muse.background.credentials.v1"
          : credentialKey;
      if (operation === "read") return sessionStorage.getItem(key) ?? "";
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
      return;
    }
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(t("Secure storage timeout"))),
          5000,
        );
      }),
    ]);
  } catch {
    throw new Error(
      t(
        "Couldn't access secure storage. Unlock your device and retry; your login has not been changed.",
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

// Non-secret records only. Read-modify-write operations use one IndexedDB
// transaction, preventing lost updates between tabs or concurrent requests.
export class LocalDatabase {
  private database?: Promise<IDBDatabase>;
  constructor(private name = "open-muse-direct-v1") {}
  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("records");
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(
          new Error(
            t("Local storage is unavailable; no cloud changes were made."),
          ),
        );
      };
    }));
  }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("records").objectStore("records").get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }
  async update<T>(
    key: string,
    transform: (value: T | undefined) => T,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      const store = tx.objectStore("records");
      const read = store.get(key);
      let result: T;
      let failure: unknown;
      read.onsuccess = () => {
        try {
          result = transform(read.result as T | undefined);
          store.put(result, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(
          failure ??
            new Error(
              t(
                "Couldn't save local data. Retry after checking device storage.",
              ),
            ),
        );
    });
  }
  set<T>(key: string, value: T) {
    return this.update<T>(key, () => value);
  }
}
