import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupabaseAuth } from "../src/supabase-auth";
import { BackgroundClient } from "../src/background-client";
import { BackgroundSettings } from "../src/BackgroundSettings";
import {
  supabaseOrigin,
  supabaseOwner,
  supabasePublicKey,
} from "../shared/supabase-auth";
import { LocalDatabase } from "../src/direct/storage";

const origin = "https://auth.example.com";
const background = "https://background.example.com";
const key = "sb_publishable_test_public_anon_key";
const subject = "ea36b4c3-a456-4787-bf54-a6c735545072";
const access = "test-account-access-token-123456789";
const refresh = "short_refresh_token";
const password = "never-saved-password";
const session = (user = subject, token = access) => ({
  access_token: token,
  refresh_token: refresh,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: user, is_anonymous: false },
});
const status = (owner = supabaseOwner(origin, subject)) => ({
  connected: true,
  owner,
  backgroundReady: false,
  credentialStorageReady: false,
  account: { provider: "supabase", workspaceReady: false },
  connection: { configured: false, revision: 0, updatedAt: null },
  schedule: {
    enabled: false,
    timezone: "UTC",
    local_time: "09:00",
    next_run_at: null,
    revision: 0,
  },
});
function fixture() {
  let locked: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("navigator", {
    language: "en-US",
    languages: ["en-US"],
    locks: {
      request: (_name: string, run: () => Promise<unknown>) => {
        const next = locked.then(run);
        locked = next.catch(() => {});
        return next;
      },
    },
  });
  let saved = "";
  const vault = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: string) => {
      saved = value;
    }),
  };
  const authFetch = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input).startsWith(`${origin}/auth/v1/`)).toBe(true);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("apikey")).toBe(key);
    return Response.json(session());
  });
  const serviceFetch = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input).startsWith(background)).toBe(true);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${access}`,
    );
    if (String(input).includes("/v1/status")) return Response.json(status());
    if (String(input).includes("/v1/runs")) return Response.json({ runs: [] });
    return Response.json({ items: [], cursor: 0, hasMore: false });
  });
  const auth = new SupabaseAuth(origin, key, authFetch, () => 1000);
  const db = new LocalDatabase(`supabase-test-${crypto.randomUUID()}`);
  const client = new BackgroundClient(
    background,
    vault,
    db,
    serviceFetch,
    auth,
  );
  return {
    auth,
    client,
    authFetch,
    serviceFetch,
    vault,
    db,
    read: () => saved,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("Native Supabase Auth trial", () => {
  it("makes no requests until explicit login and saves only a server-verified session", async () => {
    const f = fixture();
    expect(f.authFetch).not.toHaveBeenCalled();
    expect(f.serviceFetch).not.toHaveBeenCalled();
    await f.client.signInAccount("person@example.com", password);
    expect(JSON.parse(String(f.authFetch.mock.calls[0][1]?.body))).toEqual({
      email: "person@example.com",
      password,
    });
    const saved = JSON.parse(f.read());
    expect(saved.owner).toBe(supabaseOwner(origin, subject));
    expect(saved.account.session).toEqual({
      userId: subject,
      accessToken: access,
      refreshToken: refresh,
      expiresAt: 3601000,
    });
    expect(f.read()).not.toContain(password);
    expect(f.client.accountConnected()).toBe(true);
    expect(JSON.stringify(await f.client.cachedFeed())).not.toContain(access);
  });
  it("registers only after an explicit action without inferring a login or saving a password", async () => {
    const f = fixture();
    await f.client.signUpAccount("person@example.com", password);
    expect(String(f.authFetch.mock.calls[0][0])).toBe(
      `${origin}/auth/v1/signup`,
    );
    expect(f.vault.write).not.toHaveBeenCalled();
    expect(f.serviceFetch).not.toHaveBeenCalled();
    expect(f.client.connected()).toBe(false);
  });
  it("never adopts a client-claimed owner when the Worker disagrees", async () => {
    const f = fixture();
    f.serviceFetch.mockResolvedValueOnce(
      Response.json(status("some-other-owner")),
    );
    await expect(
      f.client.signInAccount("person@example.com", password),
    ).rejects.toThrow("identity changed");
    expect(f.vault.write).not.toHaveBeenCalled();
    expect(f.client.connected()).toBe(false);
  });
  it("does not silently switch an existing account or export Ark credentials during login", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    const source = { backgroundConfiguration: vi.fn() };
    await expect(f.client.syncConfiguration(source)).rejects.toThrow(
      "Encrypted credential storage",
    );
    expect(source.backgroundConfiguration).not.toHaveBeenCalled();
    await expect(
      f.client.signInAccount("other@example.com", password),
    ).rejects.toThrow("Disconnect");
    expect(f.authFetch).toHaveBeenCalledTimes(1);
  });
  it("renews once on explicit request and preserves the same user and pending action", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    expect(f.authFetch).toHaveBeenCalledTimes(1);
    await f.client.renewAccountLogin();
    expect(String(f.authFetch.mock.calls[1][0])).toContain(
      "grant_type=refresh_token",
    );
    expect(JSON.parse(String(f.authFetch.mock.calls[1][1]?.body))).toEqual({
      refresh_token: refresh,
    });
    expect(JSON.parse(f.read()).account.refreshPending).toBeUndefined();
    expect((await f.client.status()).owner).toBe(
      supabaseOwner(origin, subject),
    );
  });
  it("persists an uncertain refresh marker and never reuses the rotated refresh token", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    f.authFetch.mockRejectedValueOnce(new Error(refresh));
    await expect(f.client.renewAccountLogin()).rejects.toThrow("not retried");
    expect(JSON.parse(f.read()).account.refreshPending).toBe(true);
    await expect(f.client.renewAccountLogin()).rejects.toThrow("Disconnect");
    const restored = new BackgroundClient(
      background,
      f.vault,
      f.db,
      f.serviceFetch,
      f.auth,
    );
    await restored.restore();
    await expect(restored.renewAccountLogin()).rejects.toThrow("Disconnect");
    await expect(restored.status()).rejects.toThrow("Disconnect");
    expect(f.authFetch).toHaveBeenCalledTimes(2);
    await restored.disconnect();
    expect(f.read()).toBe("");
  });
  it("keeps a verified rotated session when the follow-up status check fails", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    f.authFetch.mockResolvedValueOnce(
      Response.json({ ...session(), refresh_token: "rotated_refresh_token" }),
    );
    f.serviceFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(f.client.renewAccountLogin()).rejects.toThrow();
    const saved = JSON.parse(f.read());
    expect(saved.account.refreshPending).toBeUndefined();
    expect(saved.account.session.refreshToken).toBe("rotated_refresh_token");
    expect(f.authFetch).toHaveBeenCalledTimes(2);
  });
  it("reports registration failures without provider status codes", async () => {
    const f = fixture();
    for (const code of [400, 422, 429]) {
      f.authFetch.mockResolvedValueOnce(
        Response.json({ code: "user_already_exists" }, { status: code }),
      );
      const error = await f.client
        .signUpAccount("person@example.com", password)
        .catch((value: Error) => value);
      expect(String(error)).toContain("not accepted");
      expect(String(error)).not.toMatch(/HTTP|\d{3}|user_already_exists/);
    }
    expect(f.authFetch).toHaveBeenCalledTimes(3);
    expect(f.vault.write).not.toHaveBeenCalled();
  });
  it("rejects renewal subject changes and remains blocked rather than adopting another user's tokens", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    f.authFetch.mockResolvedValueOnce(
      Response.json(session("32e1f21d-1b6e-4a19-805f-1d9021499a8d")),
    );
    await expect(f.client.renewAccountLogin()).rejects.toThrow(
      "identity changed",
    );
    expect(JSON.parse(f.read()).owner).toBe(supabaseOwner(origin, subject));
    await expect(f.client.status()).rejects.toThrow("Disconnect");
  });
  it("does not renew the same session in two windows or on devices without cross-window locks", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    const other = new BackgroundClient(
      background,
      f.vault,
      f.db,
      f.serviceFetch,
      f.auth,
    );
    await other.restore();
    // A rotated token makes the stale second window fail before repeating POST.
    f.authFetch.mockResolvedValueOnce(
      Response.json({ ...session(), refresh_token: "new_refresh_token" }),
    );
    const results = await Promise.allSettled([
      f.client.renewAccountLogin(),
      other.renewAccountLogin(),
    ]);
    expect(
      results.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.authFetch).toHaveBeenCalledTimes(2);
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    await expect(f.client.renewAccountLogin()).rejects.toThrow("safely");
    expect(f.authFetch).toHaveBeenCalledTimes(2);
  });
  it("restores only into the same API and Auth origins without making refresh writes", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    const restored = new BackgroundClient(
      background,
      f.vault,
      f.db,
      f.serviceFetch,
      f.auth,
    );
    await restored.restore();
    expect(restored.accountConnected()).toBe(true);
    expect(f.authFetch).toHaveBeenCalledTimes(1);
    const other = new BackgroundClient(
      background,
      f.vault,
      f.db,
      f.serviceFetch,
      new SupabaseAuth("https://other.example.com", key),
    );
    await expect(other.restore()).rejects.toThrow("does not match");
  });
  it("rejects malformed sessions and never echoes provider errors or retries writes", async () => {
    const f = fixture();
    for (const response of [
      { ...session(), user: { id: subject, is_anonymous: true } },
      { ...session(), token_type: "admin" },
      { ...session(), user: { id: "unverified" } },
    ]) {
      f.authFetch.mockResolvedValueOnce(Response.json(response));
      await expect(
        f.auth.signIn("person@example.com", password),
      ).rejects.toThrow("invalid login");
    }
    f.authFetch.mockResolvedValueOnce(
      Response.json({ message: password }, { status: 400 }),
    );
    await expect(
      f.auth.signIn("person@example.com", password),
    ).rejects.not.toThrow(password);
    expect(f.authFetch).toHaveBeenCalledTimes(4);
    expect(f.vault.write).not.toHaveBeenCalled();
  });
  it("rejects unsafe origins, incomplete configuration, and service-role keys", () => {
    for (const value of [
      "http://auth.example",
      "https://auth.example/path",
      "https://user:pass@auth.example",
      "https://auth.example#token",
    ])
      expect(() => supabaseOrigin(value)).toThrow();
    expect(() => new SupabaseAuth(origin, "")).toThrow("together");
    expect(() => supabasePublicKey("sb_secret_do_not_bundle_me")).toThrow(
      "publishable",
    );
    expect(() =>
      supabasePublicKey(
        `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: "service_role" }))}.signature`,
      ),
    ).toThrow("publishable");
    expect(
      supabasePublicKey(
        `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: "anon" }))}.signature`,
      ),
    ).not.toBe("");
  });
  it.each([[["en"]], [["zh-Hant", "en"]], [["fr", "en"]]])(
    "renders the account entry using system language preferences %j",
    (languages) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", languages);
      const f = fixture();
      const html = renderToStaticMarkup(
        <BackgroundSettings service={f.client} />,
      );
      const chinese = languages[0].startsWith("zh");
      expect(html).toContain(chinese ? "账号邮箱" : "Account email");
      expect(html).toContain(
        chinese ? "当前仅试用账号登录" : "Account login trial only",
      );
      expect(html).not.toContain("muse_device_…");
      expect(f.authFetch).not.toHaveBeenCalled();
    },
  );
});
