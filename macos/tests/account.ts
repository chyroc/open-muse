import type { AccountProvider } from "../../src/direct/auth";
import { testAccount } from "../../tests/account-fixture";

// A signed-in Open Muse account for the Mac tests whose Ark key is whatever
// `read` returns: a saved login as JSON ({ apiKey, project }), or "" for an
// account that has no key yet. `fetcher` is the Ark stand-in the service
// creates the workspace through, when a test reaches that far.
export function vaultAccount(
  read: () => Promise<string>,
  fetcher: typeof fetch = async () => {
    throw new Error("This test must not create a workspace.");
  },
): AccountProvider {
  const { account } = testAccount(fetcher, "muse_user_mac");
  return {
    ...account,
    async accountCredential() {
      const raw = await read();
      if (!raw) return { configured: false, revision: 0, updatedAt: null };
      const saved = JSON.parse(raw) as { apiKey: string; project?: string };
      const credential = { apiKey: saved.apiKey, project: saved.project ?? "" };
      // The workspace the service would create uses the same key.
      await account.saveAccountCredential(credential, 0);
      return { configured: true, revision: 1, updatedAt: 1, credential };
    },
  };
}
