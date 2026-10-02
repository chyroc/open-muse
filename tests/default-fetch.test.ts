import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuth } from "../src/supabase-auth";
import { BackgroundClient } from "../src/background-client";

// WebKit and Chromium throw when fetch runs with a receiver other than the
// global object, e.g. `this.fetcher(...)` holding the bare global function.
function browserFetch(this: unknown, input: RequestInfo | URL) {
  if (this !== undefined && this !== globalThis)
    return Promise.reject(new TypeError("Illegal invocation"));
  return Promise.resolve(
    String(input).includes("/auth/v1/")
      ? Response.json({ error: "denied" }, { status: 400 })
      : Response.json({ error: "Sign in again." }, { status: 401 }),
  );
}

describe("default fetch in the native clients", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reaches Auth with the built-in fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(browserFetch));
    const auth = new SupabaseAuth(
      "https://auth.example.com",
      "sb_publishable_test_public_anon_key",
    );
    await expect(auth.signIn("user@example.com", "password1")).rejects.toThrow(
      "HTTP 400",
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect([undefined, globalThis]).toContain(
      vi.mocked(fetch).mock.contexts[0],
    );
  });

  it("reaches the Open Muse service with the built-in fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(browserFetch));
    const client = new BackgroundClient(
      "https://background.example",
      undefined,
      undefined,
      undefined,
      new SupabaseAuth(
        "https://auth.example.com",
        "sb_publishable_test_public_anon_key",
        async () =>
          Response.json({
            access_token: "test-account-access-token-123456789",
            refresh_token: "short_refresh_token",
            expires_in: 3600,
            token_type: "bearer",
            user: {
              id: "ea36b4c3-a456-4787-bf54-a6c735545072",
              is_anonymous: false,
            },
          }),
      ),
    );
    await client.signInAccount("user@example.com", "password1").catch(() => {});
    expect(fetch).toHaveBeenCalled();
    for (const receiver of vi.mocked(fetch).mock.contexts)
      expect([undefined, globalThis]).toContain(receiver);
  });
});
