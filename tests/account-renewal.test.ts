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

describe("Saving a key Ark rejects", () => {
  // Ark answers a rejected key without CORS headers, so the direct check
  // fails like an unreachable server; the service then says why.
  it("lets the service check the key when the direct check cannot be read", async () => {
    const network = Object.assign(new Error("unreachable"), {
      name: "NetworkError",
    });
    const refusal = new Error("Ark rejected this API key.");
    const account = {
      accountConfigured: () => true,
      accountOwner: () => "muse_user_one",
      accountCredential: vi.fn(async () => ({
        configured: false,
        revision: 0,
        updatedAt: null,
      })),
      saveAccountCredential: vi.fn(async () => {
        throw refusal;
      }),
    } as unknown as AccountProvider;
    const auth = new DirectAuth(
      vi.fn<typeof fetch>(async () => {
        throw network;
      }),
      account,
    );
    await auth.sync();
    await expect(
      auth.execute("api-key", {
        apiKey: "ark-rejected-key-000000000000",
        confirm: true,
      }),
    ).rejects.toBe(refusal);
    expect(account.saveAccountCredential).toHaveBeenCalledOnce();
  });
  it("stops at a direct refusal Ark could explain", async () => {
    const account = {
      accountConfigured: () => true,
      accountOwner: () => "muse_user_one",
      accountCredential: vi.fn(async () => ({
        configured: false,
        revision: 0,
        updatedAt: null,
      })),
      saveAccountCredential: vi.fn(),
    } as unknown as AccountProvider;
    const auth = new DirectAuth(
      vi.fn<typeof fetch>(async () =>
        Response.json({ error: { code: "AccessDenied" } }, { status: 403 }),
      ),
      account,
    );
    await auth.sync();
    await expect(
      auth.execute("api-key", {
        apiKey: "ark-limited-key-0000000000000",
        confirm: true,
      }),
    ).rejects.toThrow("This API key is not allowed to do this.");
    expect(account.saveAccountCredential).not.toHaveBeenCalled();
  });
});
