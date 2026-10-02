import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupabaseAuth } from "../src/supabase-auth";
import { BackgroundClient } from "../src/background-client";
import { BackgroundSettings } from "../src/BackgroundSettings";
import { AccountPanel } from "../src/AccountPanel";
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
  account: {
    provider: "supabase",
    credential: { configured: false, revision: 0, updatedAt: null },
  },
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
  let now = 1000;
  const auth = new SupabaseAuth(origin, key, authFetch, () => now);
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
    advance: (ms: number) => {
      now += ms;
    },
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
    ).rejects.toThrow("before signing in to another Open Muse account");
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
  it("renews automatically once, shortly before the access token expires", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    await f.client.status();
    expect(f.authFetch).toHaveBeenCalledTimes(1);
    f.advance(3600_000 - 60_000);
    f.authFetch.mockResolvedValueOnce(
      Response.json({ ...session(), refresh_token: "auto_refresh_token" }),
    );
    await Promise.all([f.client.status(), f.client.status()]);
    expect(f.authFetch).toHaveBeenCalledTimes(2);
    expect(String(f.authFetch.mock.calls[1][0])).toContain(
      "grant_type=refresh_token",
    );
    expect(JSON.parse(f.read()).account.session.refreshToken).toBe(
      "auto_refresh_token",
    );
  });
  it("revokes the session at the provider once on sign-out and always removes it locally", async () => {
    for (const reachable of [true, false]) {
      const f = fixture();
      await f.client.signInAccount("person@example.com", password);
      if (reachable)
        f.authFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      else f.authFetch.mockRejectedValueOnce(new Error("offline"));
      expect(await f.client.signOutAccount()).toEqual({ revoked: reachable });
      const [url, init] = f.authFetch.mock.calls[1];
      expect(String(url)).toBe(`${origin}/auth/v1/logout?scope=local`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${access}`,
      );
      expect(f.authFetch).toHaveBeenCalledTimes(2);
      expect(f.read()).toBe("");
      expect(f.client.accountOwner()).toBeUndefined();
    }
  });
  it("persists an uncertain refresh marker and never reuses the rotated refresh token", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    f.authFetch.mockRejectedValueOnce(new Error(refresh));
    await expect(f.client.renewAccountLogin()).rejects.toThrow("not retried");
    expect(JSON.parse(f.read()).account.refreshPending).toBe(true);
    await expect(f.client.renewAccountLogin()).rejects.toThrow(
      "Sign out of Open Muse",
    );
    const restored = new BackgroundClient(
      background,
      f.vault,
      f.db,
      f.serviceFetch,
      f.auth,
    );
    await restored.restore();
    await expect(restored.renewAccountLogin()).rejects.toThrow(
      "Sign out of Open Muse",
    );
    await expect(restored.status()).rejects.toThrow("Sign out of Open Muse");
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
    await expect(f.client.status()).rejects.toThrow("Sign out of Open Muse");
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
        <>
          <AccountPanel
            service={f.client}
            client={{ accountChanged: async () => {} }}
            onChanged={() => {}}
          />
          <BackgroundSettings service={f.client} />
        </>,
      );
      const chinese = languages[0].startsWith("zh");
      expect(html).toContain(chinese ? "账号邮箱" : "Account email");
      expect(html).toContain(chinese ? "未登录" : "Not signed in");
      expect(html).toContain(
        chinese
          ? "请先在上方登录 Open Muse 账号，再使用后台功能。"
          : "Sign in to your Open Muse account above to use background features.",
      );
      expect(html).not.toContain("muse_device_…");
      expect(html).not.toMatch(/trial|试用/);
      expect(f.authFetch).not.toHaveBeenCalled();
    },
  );
});
describe("Upcoming delivery by the service", () => {
  it("reads and saves delivery for the signed-in account with confirmation", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    const delivery = {
      enabled: true,
      session_id: "sesn_main",
      language: "zh-CN",
      since: 5,
      revision: 2,
      state: "active",
    };
    f.serviceFetch.mockImplementation(async (input) => {
      if (String(input).includes("/v1/status"))
        return Response.json({
          ...status(),
          upcoming: { delivery: "server", session_id: "sesn_main" },
        });
      return Response.json(delivery);
    });
    expect(await f.client.upcomingDelivery()).toEqual(delivery);
    expect(
      await f.client.saveUpcomingDelivery({
        session_id: "sesn_main",
        language: "zh-CN",
        enabled: true,
        revision: 1,
      }),
    ).toEqual(delivery);
    const put = f.serviceFetch.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )!;
    expect(String(put[0])).toBe(`${background}/v1/account/upcoming`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({
      session_id: "sesn_main",
      language: "zh-CN",
      enabled: true,
      revision: 1,
      confirm: true,
    });
    f.serviceFetch.mockImplementation(async (input) =>
      String(input).includes("/v1/status")
        ? Response.json(status())
        : Response.json({ error: "stale" }, { status: 409 }),
    );
    await expect(
      f.client.saveUpcomingDelivery({
        session_id: "sesn_main",
        language: "en",
        enabled: false,
        revision: 1,
      }),
    ).rejects.toThrow("Reminder delivery changed on another device");
  });
  it("registers, lists and forgets this account's devices", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", password);
    const id = "3f2c8f0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const device = {
      id,
      name: "Studio Mac",
      platform: "mac" as const,
      app_version: "0.2.0",
      last_seen_at: 1,
    };
    f.serviceFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/status")) return Response.json(status());
      if (init?.method === "DELETE") return Response.json({ ok: true });
      if (init?.method === "PUT") return Response.json(device);
      return Response.json({ devices: [device] });
    });
    expect(
      await f.client.registerDevice(id, {
        name: "Studio Mac",
        platform: "mac",
        app_version: "0.2.0",
      }),
    ).toEqual(device);
    const put = f.serviceFetch.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )!;
    expect(String(put[0])).toBe(`${background}/v1/account/devices/${id}`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({
      name: "Studio Mac",
      platform: "mac",
      app_version: "0.2.0",
    });
    expect(await f.client.devices()).toEqual([device]);
    expect(await f.client.forgetDevice(id)).toEqual({ ok: true });
    // Ids and names are checked before any request.
    expect(() => f.client.registerDevice("Not-A-Uuid", device)).toThrow();
    expect(() =>
      f.client.registerDevice(id, {
        name: "two\nlines",
        platform: "mac",
        app_version: "1",
      }),
    ).toThrow();
  });
});
