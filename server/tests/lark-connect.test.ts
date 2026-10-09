import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
};
const [ALICE, BOB] = Object.keys(users);

// A stand-in for Feishu's public device flows: the person finishes each step
// when the test says so.
const feishu = {
  appApproved: false,
  userApproved: false,
  denied: false,
  refreshes: 0,
  requests: [] as { url: string; body: string; auth: string | null }[],
};
let tokenSerial = 0;
const upstream = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  if (url.startsWith(origin)) {
    const id = users[(headers.get("Authorization") ?? "").slice(7)];
    return id
      ? Response.json({ id, is_anonymous: false })
      : Response.json({}, { status: 401 });
  }
  const body = String(init?.body ?? "");
  feishu.requests.push({ url, body, auth: headers.get("Authorization") });
  if (url.endsWith("/lark-cli/apis/scopes.json"))
    return Response.json({
      scopes: {
        docs: {
          user_scopes: ["docs:document.content:read", "bad scope!"],
        },
        calendar: { user_scopes: ["calendar:calendar:read"] },
        // Kept for administrators: never requested.
        mail: {
          user_scopes: [
            "mail:user_mailbox.message:send",
            "mail:user_mailbox:readonly",
          ],
        },
        okr: { user_scopes: ["okr:okr.content:readonly"] },
      },
    });
  if (url.endsWith("/oauth/v1/app/registration")) {
    const form = new URLSearchParams(body);
    if (form.get("action") === "begin")
      return Response.json({
        device_code: "app-device",
        user_code: "APP-CODE",
        verification_uri: "https://open.feishu.cn/page/cli",
        expires_in: 3600,
        interval: 5,
      });
    return feishu.appApproved
      ? Response.json({
          client_id: "cli_test",
          client_secret: "app-secret",
          user_info: { open_id: "ou_1", tenant_brand: "feishu" },
        })
      : Response.json({ error: "authorization_pending" }, { status: 400 });
  }
  if (url.endsWith("/oauth/v1/device_authorization"))
    return Response.json({
      device_code: "user-device",
      user_code: "USER-CODE",
      verification_uri_complete:
        "https://accounts.feishu.cn/oauth/v1/device/verify?user_code=USER-CODE",
      expires_in: 240,
      interval: 5,
    });
  if (url.endsWith("/oauth/v3/token")) {
    const refreshing = body.startsWith("{");
    if (refreshing) feishu.refreshes++;
    else if (feishu.denied)
      return Response.json({ error: "access_denied" }, { status: 400 });
    else if (!feishu.userApproved)
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    tokenSerial++;
    return Response.json({
      access_token: `u-access-${tokenSerial}`,
      expires_in: 7200,
      refresh_token: `u-refresh-${tokenSerial}`,
      refresh_token_expires_in: 604800,
      scope: "docx:document:readonly calendar:calendar:read offline_access",
    });
  }
  if (url.endsWith("/open-apis/authen/v1/user_info"))
    return Response.json({ data: { open_id: "ou_1", name: "Alice" } });
  return Response.json({}, { status: 404 });
});

let env: Env;
let now = Date.now();
const call = (token: string, path: string, method = "GET") =>
  handle(
    new Request(`https://background.example${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
    upstream,
  );
const status = async (user: string, method = "GET") =>
  (await (await call(user, "/v1/lark/connect", method)).json()) as Record<
    string,
    unknown
  >;
const credentials = (token: string, origin?: string) =>
  handle(
    new Request("https://background.example/v1/lark/sandbox/credentials", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(origin ? { Origin: origin } : {}),
      },
    }),
    env,
    upstream,
  );
const later = (seconds: number) => {
  now += seconds * 1000;
};

describe("Lark connection set up by the service", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("k".repeat(32)) },
      }),
    };
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await fixture?.dispose();
  });

  it("registers an app, authorizes the person, and hands sandboxes a user token", async () => {
    expect(await status(ALICE)).toEqual({ phase: "none" });
    const started = await status(ALICE, "POST");
    expect(started).toMatchObject({
      phase: "app",
      url: "https://open.feishu.cn/page/cli?user_code=APP-CODE&from=open-muse",
    });
    // Still waiting: polled at most once per interval.
    expect(await status(ALICE)).toMatchObject({ phase: "app" });
    const polls = () =>
      feishu.requests.filter((r) => r.body.includes("action=poll")).length;
    const before = polls();
    expect(await status(ALICE)).toMatchObject({ phase: "app" });
    expect(polls()).toBe(before);

    feishu.appApproved = true;
    later(6);
    const user = await status(ALICE);
    expect(user).toMatchObject({
      phase: "user",
      url: "https://accounts.feishu.cn/oauth/v1/device/verify?user_code=USER-CODE",
    });
    const authorize = feishu.requests.find((r) =>
      r.url.endsWith("/device_authorization"),
    )!;
    expect(authorize.auth).toBe(`Basic ${btoa("cli_test:app-secret")}`);
    expect(new URLSearchParams(authorize.body).get("scope")).toBe(
      "calendar:calendar:read docs:document.content:read mail:user_mailbox:readonly offline_access",
    );

    feishu.userApproved = true;
    later(6);
    expect(await status(ALICE)).toMatchObject({
      phase: "connected",
      name: "Alice",
    });
    // Nothing secret reaches the app, and the row is sealed.
    expect(JSON.stringify(await status(ALICE))).not.toMatch(
      /secret|refresh|u-access/,
    );
    const rows = await env.DB.prepare(
      "SELECT encrypted FROM lark_connections",
    ).all<{ encrypted: string }>();
    expect(rows.results[0].encrypted).not.toMatch(/app-secret|u-refresh/);

    const { token } = (await (
      await call(ALICE, "/v1/lark/tokens", "POST")
    ).json()) as { token: string };
    const issued = (await (await credentials(token)).json()) as Record<
      string,
      unknown
    >;
    expect(issued).toMatchObject({
      app_id: "cli_test",
      brand: "feishu",
      open_id: "ou_1",
      access_token: "u-access-1",
    });
    expect(JSON.stringify(issued)).not.toMatch(/secret|refresh/);
    // Close to expiry, the service renews it with the refresh token.
    later(7200 - 60);
    expect(await (await credentials(token)).json()).toMatchObject({
      access_token: "u-access-2",
    });
    expect(feishu.refreshes).toBe(1);
    expect((await credentials(token, "https://evil.example")).status).toBe(403);
    expect((await credentials("not-a-real-token-00000000000000")).status).toBe(
      401,
    );
  });

  it("keeps each account's connection to itself", async () => {
    expect(await status(BOB)).toEqual({ phase: "none" });
    const { token } = (await (
      await call(BOB, "/v1/lark/tokens", "POST")
    ).json()) as { token: string };
    expect((await credentials(token)).status).toBe(404);
  });

  it("reuses the app on reconnect and reports a refusal", async () => {
    expect(await status(ALICE, "DELETE")).toEqual({ phase: "none" });
    feishu.userApproved = false;
    feishu.denied = true;
    const begins = feishu.requests.filter((r) =>
      r.body.includes("action=begin"),
    ).length;
    expect(await status(ALICE, "POST")).toMatchObject({ phase: "user" });
    expect(
      feishu.requests.filter((r) => r.body.includes("action=begin")).length,
    ).toBe(begins);
    later(6);
    expect(await status(ALICE)).toEqual({ phase: "none", error: "denied" });
    // Removing the saved sign-in also removes the connection.
    feishu.denied = false;
    feishu.userApproved = true;
    await status(ALICE, "POST");
    later(6);
    expect(await status(ALICE)).toMatchObject({ phase: "connected" });
    await call(ALICE, "/v1/lark/state", "DELETE");
    expect(await status(ALICE)).toEqual({ phase: "none" });
  });

  it("starts over without the chosen app when asked", async () => {
    const begins = () =>
      feishu.requests.filter((r) => r.body.includes("action=begin")).length;
    // Choose an app, then stop before authorizing.
    await status(ALICE, "DELETE");
    feishu.appApproved = true;
    feishu.userApproved = false;
    expect(await status(ALICE, "POST")).toMatchObject({ phase: "app" });
    later(6);
    expect(await status(ALICE)).toMatchObject({ phase: "user" });
    // Forgetting the app as well: the next setup chooses an app again.
    expect(
      await (await call(ALICE, "/v1/lark/connect?app=forget", "DELETE")).json(),
    ).toEqual({ phase: "none" });
    const before = begins();
    expect(await status(ALICE, "POST")).toMatchObject({ phase: "app" });
    expect(begins()).toBe(before + 1);
    feishu.userApproved = true;
  });

  it("lets a setup step expire", async () => {
    await status(BOB, "POST");
    later(3601);
    expect(await status(BOB)).toEqual({ phase: "none", error: "expired" });
  });
});
