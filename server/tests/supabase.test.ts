import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { authenticate } from "../src/auth";
import { supabaseOwner } from "../../shared/supabase-auth";
import type { Env } from "../src/env";
import { Repository } from "../src/repository";

const origin = "https://auth.example.com";
const publicKey = "sb_publishable_test_public_key_only";
const token = "test-supabase-session-access-token";
const ids = [
  "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "316c004b-07b0-4675-9b8d-deb5a740f03b",
];
const request = (
  path = "/v1/status",
  bearer = token,
  method = "GET",
  body?: unknown,
) =>
  new Request(`https://background.example${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
describe("Supabase end-user authentication trial", () => {
  let fixture: Awaited<ReturnType<typeof database>>, env: Env;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      OWNER_ID: "legacy-owner",
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: publicKey,
      BACKGROUND_ENABLED: "true",
    };
  });
  afterAll(async () => fixture.dispose());
  const verifier = (id = ids[0]) =>
    vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(`${origin}/auth/v1/user`);
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).get("apikey")).toBe(publicKey);
      return Response.json({
        id,
        is_anonymous: false,
        user_metadata: { ownerId: "forged-owner" },
      });
    });
  it("uses the provider-verified subject, not email, metadata, query IDs, or Ark keys", async () => {
    const upstream = verifier();
    expect(
      await authenticate(
        request("/v1/status?owner=forged-owner"),
        env,
        upstream,
      ),
    ).toBe(supabaseOwner(origin, ids[0]));
    expect(await authenticate(request(), env, verifier(ids[1]))).not.toBe(
      supabaseOwner(origin, ids[0]),
    );
    expect(
      await authenticate(
        request("/v1/status", "another-device-access-token"),
        env,
        verifier(),
      ),
    ).toBe(supabaseOwner(origin, ids[0]));
  });
  it("keeps per-user results isolated and cannot see the old private owner", async () => {
    const a = new Repository(env.DB, supabaseOwner(origin, ids[0]));
    const legacy = new Repository(env.DB, env.OWNER_ID);
    await a.enqueue("manual:account-test", Date.now(), Date.now());
    await legacy.enqueue("manual:legacy-test", Date.now(), Date.now());
    const first = (await (
      await handle(request("/v1/runs"), env, verifier())
    ).json()) as { runs: unknown[] };
    const second = (await (
      await handle(request("/v1/runs"), env, verifier(ids[1]))
    ).json()) as { runs: unknown[] };
    expect(first.runs).toHaveLength(1);
    expect(second.runs).toEqual([]);
  });
  it.each([401, 403, 429, 500])(
    "fails closed on provider HTTP %s without echoing secrets or retrying",
    async (status) => {
      const upstream = vi.fn<typeof fetch>(async () =>
        Response.json({ message: token }, { status }),
      );
      const response = await handle(request(), env, upstream);
      expect(response.status).toBe(status < 429 ? 401 : 503);
      expect(await response.text()).not.toContain(token);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects forged tokens, anonymous users, malformed users, and redirected verification", async () => {
    for (const user of [
      { id: "forged" },
      { id: ids[0], is_anonymous: true },
      { id: ids[0], is_anonymous: "false" },
    ])
      expect(
        (await handle(request(), env, async () => Response.json(user))).status,
      ).toBe(401);
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(token);
    });
    expect((await handle(request(), env, fetcher)).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const never = vi.fn<typeof fetch>();
    expect(
      (await handle(request("/v1/status", "malformed"), env, never)).status,
    ).toBe(401);
    expect(never).not.toHaveBeenCalled();
  });
  it("rejects unsafe provider origins and privileged keys before sending anything", async () => {
    const never = vi.fn<typeof fetch>();
    for (const value of [
      "http://auth.example",
      "https://auth.example/path",
      "https://auth.example?other=x",
      "https://user:pass@auth.example",
    ])
      expect(
        (await handle(request(), { ...env, SUPABASE_AUTH_URL: value }, never))
          .status,
      ).toBe(503);
    const service = [
      "eyJhbGciOiJIUzI1NiJ9",
      btoa(JSON.stringify({ role: "service_role" })),
      "test-signature",
    ].join(".");
    expect(
      (await handle(request(), { ...env, SUPABASE_ANON_KEY: service }, never))
        .status,
    ).toBe(503);
    expect(
      (
        await handle(
          request(),
          { ...env, SUPABASE_ANON_KEY: "sb_secret_private_service_key" },
          never,
        )
      ).status,
    ).toBe(503);
    expect(never).not.toHaveBeenCalled();
  });
  it("does not borrow service Ark access or accept uploads before end-user workspace migration", async () => {
    const response = await handle(
      request(),
      {
        ...env,
        ARK_API_KEY: "existing-ark-private-key",
        ARK_AGENT_ID: "agent",
        ARK_AGENT_VERSION: "1",
        ARK_ENVIRONMENT_ID: "environment",
        ARK_MEMORY_STORE_ID: "memory",
      },
      verifier(),
    );
    expect(await response.json()).toMatchObject({
      owner: supabaseOwner(origin, ids[0]),
      backgroundReady: false,
      credentialStorageReady: false,
      account: { provider: "supabase", workspaceReady: false },
    });
    const upstream = verifier();
    expect(
      (await handle(request("/v1/connection", token, "PUT", {}), env, upstream))
        .status,
    ).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(
      (
        await handle(
          request("/v1/runs", token, "POST", { confirm: true }),
          env,
          verifier(),
        )
      ).status,
    ).toBe(409);
  });
});
