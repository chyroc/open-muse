import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { database } from "./database";
import {
  ConnectionStore,
  configurationEnv,
  decryptConfiguration,
  encryptConfiguration,
} from "../src/connection";
import { handle } from "../src/index";
import { tokenHash } from "../src/auth";
import { Repository } from "../src/repository";
import { ArkRemote } from "../src/ark";
import { tick } from "../src/jobs";
import type { Env } from "../src/env";
import type { BackgroundConfiguration } from "../../shared/background-connection";

const config: BackgroundConfiguration = {
  apiKey: "test-private-existing-ark-key",
  project: "test-project",
  agentId: "agent-existing",
  agentVersion: 3,
  environmentId: "env-existing",
  memoryStoreId: "memory-existing",
};
const ring = (current = "v1") =>
  JSON.stringify({
    current,
    keys: {
      v1: btoa("a".repeat(32)),
      v2: btoa("b".repeat(32)),
    },
  });
const token = "muse_device_" + "a".repeat(40);
function upstream() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    expect(init?.redirect).toBe("error");
    if (path.endsWith("/agents/agent-existing"))
      return Response.json({
        id: config.agentId,
        version: config.agentVersion,
        tools: [{ type: "agent_toolset_20260701" }],
      });
    if (path.endsWith("/environments/env-existing"))
      return Response.json({ id: config.environmentId });
    if (path.endsWith("/memory_stores/memory-existing"))
      return Response.json({ id: config.memoryStoreId });
    return Response.json({ data: [] });
  });
}
describe("Encrypted app connection custody", () => {
  let fixture: Awaited<ReturnType<typeof database>>,
    env: Env,
    store: ConnectionStore;
  beforeAll(async () => {
    fixture = await database();
  });
  afterAll(async () => fixture.dispose());
  beforeEach(async () => {
    const ownerId = crypto.randomUUID();
    env = {
      DB: fixture.db,
      OWNER_ID: ownerId,
      CREDENTIAL_ENCRYPTION_KEYS: ring(),
      DEVICE_TOKEN_HASHES: JSON.stringify({
        [await tokenHash(token)]: { ownerId, deviceLabel: "test-device" },
      }),
      BACKGROUND_ENABLED: "true",
    };
    store = new ConnectionStore(env);
  });
  const request = (value: unknown, method = "PUT") =>
    new Request("https://example.com/v1/connection", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
  it("encrypts the entire configuration with a fresh authenticated nonce", async () => {
    const encrypted = await encryptConfiguration(env, env.OWNER_ID, 1, config);
    expect(encrypted).not.toContain(config.apiKey);
    expect(encrypted).not.toContain(config.agentId);
    expect(encrypted).not.toContain(config.project);
    expect(await encryptConfiguration(env, env.OWNER_ID, 1, config)).not.toBe(
      encrypted,
    );
    expect(
      await decryptConfiguration(env, env.OWNER_ID, {
        encrypted,
        revision: 1,
        updated_at: 1,
      }),
    ).toEqual(config);
  });
  it("rejects owner substitution, stale revisions, ciphertext tampering, and a missing key", async () => {
    const encrypted = await encryptConfiguration(env, env.OWNER_ID, 1, config);
    const row = { encrypted, revision: 1, updated_at: 1 };
    for (const [e, owner, r] of [
      [env, "someone-else", row],
      [env, env.OWNER_ID, { ...row, revision: 2 }],
      [{ ...env, CREDENTIAL_ENCRYPTION_KEYS: undefined }, env.OWNER_ID, row],
      [
        env,
        env.OWNER_ID,
        {
          ...row,
          encrypted: encrypted.replace('"ciphertext":"', '"ciphertext":"AAAA'),
        },
      ],
    ] as const)
      await expect(decryptConfiguration(e, owner, r)).rejects.toThrow(
        "storage is unavailable",
      );
  });
  it("supports key rotation while retaining the previous decrypt key", async () => {
    const old = await encryptConfiguration(env, env.OWNER_ID, 1, config);
    env.CREDENTIAL_ENCRYPTION_KEYS = ring("v2");
    expect(
      await decryptConfiguration(env, env.OWNER_ID, {
        encrypted: old,
        revision: 1,
        updated_at: 1,
      }),
    ).toEqual(config);
    expect(
      JSON.parse(await encryptConfiguration(env, env.OWNER_ID, 2, config))
        .keyId,
    ).toBe("v2");
  });
  it("accepts the current app agent without granting its tools or writing to MA", async () => {
    const fetcher = upstream();
    const response = await handle(
      request({ config, revision: 0, confirm: true }),
      env,
      fetcher,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      configured: true,
      revision: 1,
      updatedAt: expect.any(Number),
    });
    for (const secret of [config.apiKey, config.agentId, config.memoryStoreId])
      expect(text).not.toContain(secret);
    expect(
      fetcher.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET",
      ),
    ).toBe(true);
    const row = await store.row();
    expect(JSON.stringify(row)).not.toContain(config.apiKey);
    expect((await store.resolve())?.env.ARK_API_KEY).toBe(config.apiKey);
  });
  it("compares revisions, safely deduplicates unchanged syncs, and permits rotation when idle", async () => {
    const fetcher = upstream();
    await store.save(config, 0, 1, fetcher);
    expect((await store.save(config, 1, 2, fetcher)).revision).toBe(1);
    await expect(store.save(config, 0, 3, fetcher)).rejects.toThrow("changed");
    expect(
      (
        await store.save(
          { ...config, apiKey: "test-another-existing-key" },
          1,
          4,
          fetcher,
        )
      ).revision,
    ).toBe(2);
  });
  it("blocks account/key changes during unresolved work", async () => {
    await store.save(config, 0, 1, upstream());
    const repo = new Repository(env.DB, env.OWNER_ID);
    await repo.enqueue("manual:unresolved-test", 2, 2);
    await expect(
      store.save(
        { ...config, apiKey: "test-another-existing-key" },
        1,
        3,
        upstream(),
      ),
    ).rejects.toThrow("unresolved");
    expect((await store.status()).revision).toBe(1);
  });
  it("pauses an existing schedule on credential replacement and rejects stale authorization bindings", async () => {
    await store.save(config, 0, 1, upstream());
    const repo = new Repository(env.DB, env.OWNER_ID);
    const hash = await new ArkRemote(
      configurationEnv(env, config),
    ).fingerprint();
    const auth = { revision: 1, hash };
    await repo.saveSchedule(
      { enabled: true, timezone: "UTC", local_time: "09:00", revision: 0 },
      1,
      auth,
    );
    await store.save(
      { ...config, apiKey: "test-another-existing-key" },
      1,
      2,
      upstream(),
    );
    expect((await repo.schedule()).enabled).toBe(false);
    await expect(
      repo.enqueue("manual:stale-authorization", 3, 3, false, auth),
    ).rejects.toThrow("Another run");
    const schedule = await repo.schedule();
    await expect(
      repo.saveSchedule({ ...schedule, enabled: true }, 3, auth),
    ).rejects.toThrow("schedule changed");
    expect(await repo.runs()).toHaveLength(0);
  });
  it("revokes encrypted credentials, cancels unsubmitted work, and pauses the schedule atomically", async () => {
    await store.save(config, 0, 1, upstream());
    const repo = new Repository(env.DB, env.OWNER_ID);
    await repo.saveSchedule(
      { enabled: true, timezone: "UTC", local_time: "09:00", revision: 0 },
      1,
    );
    await repo.enqueue("manual:queued-test", 2, 2);
    await expect(store.remove(0, 3)).rejects.toThrow("changed");
    expect((await repo.schedule()).enabled).toBe(true);
    expect((await store.remove(1, 4)).configured).toBe(false);
    expect(await store.resolve()).toBeUndefined();
    expect((await store.row())?.encrypted).toBeNull();
    expect((await repo.schedule()).enabled).toBe(false);
    expect((await repo.runs())[0].phase).toBe("failed");
    expect((await store.save(config, 2, 5, upstream())).revision).toBe(3);
    expect((await repo.schedule()).enabled).toBe(false);
  });
  it("marks uncertain submissions for review and only restores their original connection", async () => {
    await store.save(config, 0, 1, upstream());
    const repo = new Repository(env.DB, env.OWNER_ID);
    await repo.enqueue("manual:submitted-test", 2, 2);
    const run = (await repo.claim(2))!;
    await repo.transition(
      run,
      "queued",
      {
        phase: "sending",
        prompt: "private pending prompt",
        connection_hash: await new ArkRemote(
          configurationEnv(env, config),
        ).fingerprint(),
      },
      2,
    );
    await store.remove(1, 3);
    expect((await repo.runs())[0].phase).toBe("needs_attention");
    const row = await env.DB.prepare(
      "SELECT prompt,lease_token FROM runs WHERE id=?",
    )
      .bind(run.id)
      .first();
    expect(row).toEqual({ prompt: "", lease_token: null });
    await expect(
      store.save(
        { ...config, apiKey: "test-another-existing-key" },
        2,
        4,
        upstream(),
      ),
    ).rejects.toThrow("unresolved");
    await store.save(config, 2, 5, upstream());
    expect((await repo.runs())[0].phase).toBe("needs_attention");
  });
  it("checks revocation before every subsequent upstream call", async () => {
    await store.save(config, 0, 1, upstream());
    const fetcher = upstream(),
      guarded = store.guardedFetch(1, fetcher);
    await guarded(
      "https://ark.cn-beijing.volces.com/api/v3/agents/agent-existing",
      { redirect: "error" },
    );
    await store.remove(1, 2);
    await expect(
      guarded("https://ark.cn-beijing.volces.com/api/v3/agents/agent-existing"),
    ).rejects.toThrow("authorization changed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never resurrects revoked credentials from legacy environment bindings", async () => {
    const legacy = configurationEnv(env, config);
    const s = new ConnectionStore(legacy);
    expect(await s.resolve()).toBeTruthy();
    await s.remove(0, 1);
    expect(await s.resolve()).toBeUndefined();
  });
  it("keeps removal available without a decrypt key and does not auto-enable generation", async () => {
    await store.save(config, 0, 1, upstream());
    const disabled = {
      ...env,
      BACKGROUND_ENABLED: "false",
      CREDENTIAL_ENCRYPTION_KEYS: undefined,
    };
    const fetcher = upstream();
    await tick(disabled, undefined, () => 10);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await handle(
          request({ revision: 1, confirm: true }, "DELETE"),
          disabled,
        )
      ).status,
    ).toBe(200);
  });
  it("requires authentication, explicit consent, bounded schemas, and a valid keyring", async () => {
    const fetcher = upstream();
    const unauthenticated = request({ config, revision: 0, confirm: true });
    unauthenticated.headers.delete("Authorization");
    expect((await handle(unauthenticated, env, fetcher)).status).toBe(401);
    for (const value of [
      { config, revision: 0, confirm: false },
      { config, revision: 0, confirm: true, owner: "other" },
      {
        config: { ...config, refreshToken: "secret-sso-token" },
        revision: 0,
        confirm: true,
      },
      {
        config: { ...config, apiKey: "cfat_not-an-ark-key" },
        revision: 0,
        confirm: true,
      },
    ])
      expect((await handle(request(value), env, fetcher)).status).toBe(400);
    expect(
      (
        await handle(
          request({ config, revision: 0, confirm: true }),
          { ...env, CREDENTIAL_ENCRYPTION_KEYS: undefined },
          fetcher,
        )
      ).status,
    ).toBe(503);
    expect(
      (await handle(request({ data: "a".repeat(9000) }), env, fetcher)).status,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes upstream errors and does not store rejected configurations", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(config.apiKey);
    });
    const result = await handle(
      request({ config, revision: 0, confirm: true }),
      env,
      fetcher,
    );
    expect(result.status).toBe(422);
    expect(await result.text()).not.toContain(config.apiKey);
    expect(await store.row()).toBeNull();
  });
});
