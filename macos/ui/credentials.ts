import type { CredentialStore } from "../../src/direct/storage";

type SecureBridge = { postMessage(body: object): Promise<unknown> };
export function macCredentials(
  getBridge: () => SecureBridge | undefined,
): CredentialStore {
  const request = async (operation: "read" | "write", value = "") => {
    const bridge = getBridge();
    if (!bridge)
      throw new Error(
        "The Mac secure storage bridge is unavailable. Your credentials have not been changed.",
      );
    // The native reply includes any Keychain authorization decision. A short
    // JavaScript timeout would abandon a successful read after the OS prompt.
    return bridge.postMessage({ operation, value });
  };
  return {
    async read() {
      const value = await request("read");
      if (typeof value !== "string")
        throw new Error("Secure storage returned an invalid response.");
      return value;
    },
    async write(value) {
      if ((await request("write", value)) !== true)
        throw new Error("Secure storage did not confirm the update.");
    },
  };
}

export const nativeCredentials = macCredentials(
  () =>
    (
      window as unknown as {
        webkit?: { messageHandlers?: { museCredentials?: SecureBridge } };
      }
    ).webkit?.messageHandlers?.museCredentials,
);
