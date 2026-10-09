import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { rewrapRetiredKeys } from "../src/account";
import { encryptConfiguration } from "../src/connection";
import { Repository } from "../src/repository";
import { supabaseOwner } from "../../shared/supabase-auth";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const publicKey = "sb_publishable_test_public_key_only";
const sharedKey = "test-shared-ark-api-key-0001";
const rotatedKey = "test-rotated-ark-api-key-0002";
// Opaque access tokens resolved by the fake Auth provider, never by the Worker.
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "alice-second-access-token-01": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
  "carol-access-token-000000001": "9b1f0c8e-5d2a-4c3e-8f7a-1e2d3c4b5a69",
};
const [alice, , bob, carol] = Object.keys(users);
const ring = (current: string, keys: Record<string, string>) =>
  JSON.stringify({ current, keys });
const v1 = btoa("a".repeat(32)),
  v2 = btoa("b".repeat(32));

function provider(arkStatus = 200) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    if (url.origin === origin) {
      expect(url.pathname).toBe("/auth/v1/user");
      const id = users[auth.replace(/^Bearer /, "")];
      return id
        ? Response.json({ id, is_anonymous: false })
        : Response.json({ message: "invalid" }, { status: 401 });
    }
    expect(url.origin).toBe("https://ark.cn-beijing.volces.com");
    // Key validation is read-only and never creates Ark resources.
    expect(init?.method ?? "GET").toBe("GET");
    expect(url.pathname).toBe("/api/v3/agents");
    return Response.json(arkStatus === 200 ? { data: [] } : { error: auth }, {
      status: arkStatus,
    });
  });
}
const call = (
  env: Env,
  token: string,
  method = "GET",
  body?: unknown,
  fetcher = provider(),
) =>
  handle(
    new Request("https://background.example/v1/account/credential", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    fetcher,
  );
const put = (
  env: Env,
  token: string,
  apiKey: string,
  revision: number,
  fetcher = provider(),
) =>
  call(
    env,
    token,
    "PUT",
    { credential: { apiKey, project: "shared" }, revision, confirm: true },
    fetcher,
  );

describe("Per-account encrypted Ark credentials", () => {
  let fixture: Awaited<ReturnType<typeof database>>, env: Env;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: publicKey,
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: ring("v1", { v1 }),
    };
  });
  afterAll(async () => fixture.dispose());

  it("stores the same Ark key separately for two accounts and shares it across one account's devices", async () => {
    expect((await put(env, alice, sharedKey, 0)).status).toBe(200);
    expect((await put(env, bob, sharedKey, 0)).status).toBe(200);
    const fromOtherDevice = await (
      await call(env, "alice-second-access-token-01")
    ).json();
    expect(fromOtherDevice).toMatchObject({
      configured: true,
      revision: 1,
      credential: { apiKey: sharedKey, project: "shared" },
    });
    const rows = await env.DB.prepare(
      "SELECT owner_id,encrypted FROM account_credentials ORDER BY owner_id",
    ).all<{ owner_id: string; encrypted: string }>();
    expect(rows.results.map((row) => row.owner_id).sort()).toEqual(
      [
        supabaseOwner(origin, users[alice]),
        supabaseOwner(origin, users[bob]),
      ].sort(),
    );
    for (const row of rows.results)
      expect(row.encrypted).not.toContain(sharedKey);
    expect(rows.results[0].encrypted).not.toBe(rows.results[1].encrypted);
  });

  it("cannot decrypt another account's ciphertext even with direct database access", async () => {
    const aliceOwner = supabaseOwner(origin, users[alice]);
    const bobOwner = supabaseOwner(origin, users[bob]);
    const stolen = await env.DB.prepare(
      "SELECT encrypted,revision FROM account_credentials WHERE owner_id=?",
    )
      .bind(aliceOwner)
      .first<{ encrypted: string; revision: number }>();
    const original = await env.DB.prepare(
      "SELECT encrypted FROM account_credentials WHERE owner_id=?",
    )
      .bind(bobOwner)
      .first<{ encrypted: string }>();
    await env.DB.prepare(
      "UPDATE account_credentials SET encrypted=? WHERE owner_id=?",
    )
      .bind(stolen!.encrypted, bobOwner)
      .run();
    const response = await call(env, bob);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(sharedKey);
    await env.DB.prepare(
      "UPDATE account_credentials SET encrypted=? WHERE owner_id=?",
    )
      .bind(original!.encrypted, bobOwner)
      .run();
    expect((await call(env, bob)).status).toBe(200);
  });

  it("rejects stale revisions from another device instead of overwriting", async () => {
    const response = await put(
      env,
      "alice-second-access-token-01",
      rotatedKey,
      0,
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(rotatedKey);
    expect(await (await call(env, alice)).json()).toMatchObject({
      revision: 1,
      credential: { apiKey: sharedKey },
    });
  });

  it("does not save a key Ark rejects and never echoes it", async () => {
    const response = await put(env, alice, rotatedKey, 1, provider(401));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(rotatedKey);
    expect(await (await call(env, alice)).json()).toMatchObject({
      revision: 1,
    });
  });

  it("rotation revokes the background binding and runs sealed with the old key", async () => {
    const owner = supabaseOwner(origin, users[alice]);
    await env.DB.prepare(
      "INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id) VALUES (?,1,?,1,'seed')",
    )
      .bind(
        owner,
        await encryptConfiguration(env, owner, 1, {
          apiKey: sharedKey,
          project: "shared",
          agentId: "agent-alice",
          agentVersion: 1,
          environmentId: "env-alice",
          memoryStoreId: "memory-alice",
        }),
      )
      .run();
    const repo = new Repository(env.DB, owner);
    await repo.saveSchedule(
      { enabled: true, timezone: "UTC", local_time: "09:00", revision: 0 },
      Date.now(),
      { revision: 1, hash: "hash" },
    );
    await repo.enqueue("manual:rotation", Date.now(), Date.now(), false, {
      revision: 1,
      hash: "hash",
    });
    const bobOwner = supabaseOwner(origin, users[bob]);
    await new Repository(env.DB, bobOwner).enqueue(
      "manual:bob",
      Date.now(),
      Date.now(),
    );
    const rotation = await put(env, alice, rotatedKey, 1);
    expect(rotation.status).toBe(200);
    const connection = await env.DB.prepare(
      "SELECT encrypted,revision FROM ark_connections WHERE owner_id=?",
    )
      .bind(owner)
      .first<{ encrypted: string | null; revision: number }>();
    expect(connection).toEqual({ encrypted: null, revision: 2 });
    expect((await repo.schedule()).enabled).toBe(false);
    expect((await repo.runs()).map((run) => run.phase)).toEqual(["failed"]);
    expect(
      (await new Repository(env.DB, bobOwner).runs()).map((run) => run.phase),
    ).toEqual(["queued"]);
    expect(await (await call(env, alice)).json()).toMatchObject({
      revision: 2,
      credential: { apiKey: rotatedKey },
    });
  });

  it("revocation removes only the requesting account's key", async () => {
    expect(
      (await call(env, alice, "DELETE", { revision: 2, confirm: true })).status,
    ).toBe(200);
    expect(await (await call(env, alice)).json()).toEqual({
      configured: false,
      revision: 3,
      updatedAt: expect.any(Number),
    });
    expect(await (await call(env, bob)).json()).toMatchObject({
      configured: true,
      credential: { apiKey: sharedKey },
    });
    expect((await put(env, alice, sharedKey, 3)).status).toBe(200);
  });

  it("rewraps retired encryption keys without changing revisions", async () => {
    const rotated = {
      ...env,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v2", { v1, v2 }),
    };
    expect(await (await call(rotated, bob)).json()).toMatchObject({
      revision: 1,
      credential: { apiKey: sharedKey },
    });
    await rewrapRetiredKeys(rotated);
    const sealed = await env.DB.prepare(
      "SELECT encrypted FROM account_credentials WHERE encrypted IS NOT NULL",
    ).all<{ encrypted: string }>();
    expect(
      new Set(sealed.results.map((row) => JSON.parse(row.encrypted).keyId)),
    ).toEqual(
      new Set(["v2"]),
    );
    const retired = {
      ...env,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v2", { v2 }),
    };
    expect(await (await call(retired, bob)).json()).toMatchObject({
      revision: 1,
      credential: { apiKey: sharedKey },
    });
  });

  it("limits how many keys one account can test with Ark", async () => {
    const checks = provider(401);
    for (let i = 0; i < 10; i++) {
      const refused = await put(env, carol, `${rotatedKey}-${i}`, 0, checks);
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({
        code: "ark_rejected",
        details: ["invalid_key"],
      });
    }
    const limited = await put(env, carol, sharedKey, 0, checks);
    expect(limited.status).toBe(429);
    expect(await limited.clone().json()).toMatchObject({
      code: "key_check_limit",
    });
    expect(await limited.text()).not.toContain(sharedKey);
    // Ten Ark calls plus eleven session verifications; the eleventh key never
    // reached Ark.
    expect(
      checks.mock.calls.filter(([input]) => String(input).includes("/api/v3/")),
    ).toHaveLength(10);
  });

  it("refuses unauthenticated callers", async () => {
    const forged = provider();
    expect(
      (
        await call(
          env,
          "forged-access-token-00000001",
          "GET",
          undefined,
          forged,
        )
      ).status,
    ).toBe(401);
    expect(forged).toHaveBeenCalledTimes(1);
  });
});
