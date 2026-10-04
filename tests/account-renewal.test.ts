import { describe, expect, it, vi } from "vitest";
import { DirectAuth, type AccountProvider } from "../src/direct/auth";

// An account whose session is renewing when the app reads it: it has no
// owner until the renewal settles.
function renewingAccount() {
  let renewing = true;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  const account = {
    accountConfigured: () => true,
    accountOwner: () => (renewing ? undefined : "muse_user_one"),
    settled: vi.fn(() => done),
    accountCredential: vi.fn(async () => ({
      configured: true,
      revision: 2,
      updatedAt: 0,
      credential: { apiKey: "ark-test-key-0000000000000000", project: "" },
    })),
  } as unknown as AccountProvider;
  return {
    account,
    finish() {
      renewing = false;
      settle();
    },
  };
}

describe("Account key during a session renewal", () => {
  it("waits for the renewal instead of treating the account as signed out", async () => {
    const { account, finish } = renewingAccount();
    const auth = new DirectAuth(vi.fn<typeof fetch>(), account);
    const synced = auth.sync();
    finish();
    await synced;
    expect(auth.syncedOwner()).toBe("muse_user_one");
    expect(auth.status()).toMatchObject({ loggedIn: true, ready: true });
    expect(account.settled).toHaveBeenCalled();
  });
});
