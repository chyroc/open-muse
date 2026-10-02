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
import { Repository } from "../src/repository";
import { ArkRemote } from "../src/ark";
import { tick } from "../src/jobs";
import type { Env } from "../src/env";
import type { BackgroundConfiguration } from "../../shared/background-connection";
import {
  accountEnv,
  seedAccount,
  session,
  withAuth,
  workspaceKey,
} from "./accounts";

let config: BackgroundConfiguration, owner: string, token: string;
// The same workspace bound with a replacement key.
const replaced = () => ({ ...config, apiKey: "test-another-existing-key" });
const account = (c = config) => ({
  credentialRevision: 1,
  workspaceKey: workspaceKey(c, owner),
});
const ring = (current = "v1") =>
  JSON.stringify({
    current,
    keys: {
      v1: btoa("a".repeat(32)),
      v2: btoa("b".repeat(32)),
    },
  });
// Ark resources carry the ownership label for the key they are read with.
function upstream() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    expect(init?.redirect).toBe("error");
    const apiKey = (new Headers(init?.headers).get("Authorization") ?? "").slice(
      7,
    );
    const label = workspaceKey({ ...config, apiKey }, owner);
    const metadata = { open_muse_workspace: label, open_muse_identity: label };
    if (path.endsWith(`/agents/${config.agentId}`))
      return Response.json({
        id: config.agentId,
        version: config.agentVersion,
        tools: [{ type: "agent_toolset_20260701" }],
        metadata,
      });
    if (path.endsWith(`/environments/${config.environmentId}`))
      return Response.json({ id: config.environmentId, metadata });
    if (path.endsWith(`/memory_stores/${config.memoryStoreId}`))
      return Response.json({ id: config.memoryStoreId, metadata });
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
    const user = session();
    owner = user.owner;
    token = user.token;
    const id = crypto.randomUUID();
    config = {
      apiKey: "test-private-existing-ark-key",
      project: "test-project",
      agentId: `agent-${id}`,
      agentVersion: 3,
      environmentId: `env-${id}`,
      memoryStoreId: `memory-${id}`,
    };
    env = accountEnv(fixture.db, {
      CREDENTIAL_ENCRYPTION_KEYS: ring(),
      BACKGROUND_ENABLED: "true",
    });
    await seedAccount(env, owner, config);
    store = new ConnectionStore(env, owner);
  });
  const workspace = () => ({
    agentId: config.agentId,
    agentVersion: config.agentVersion,
    environmentId: config.environmentId,
    memoryStoreId: config.memoryStoreId,
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
    const encrypted = await encryptConfiguration(env, owner, 1, config);
    expect(encrypted).not.toContain(config.apiKey);
    expect(encrypted).not.toContain(config.agentId);
    expect(encrypted).not.toContain(config.project);
    expect(await encryptConfiguration(env, owner, 1, config)).not.toBe(
      encrypted,
    );
    expect(
      await decryptConfiguration(env, owner, {
        encrypted,
        revision: 1,
        updated_at: 1,
      }),
    ).toEqual(config);
  });
  it("rejects owner substitution, stale revisions, ciphertext tampering, and a missing key", async () => {
    const encrypted = await encryptConfiguration(env, owner, 1, config);
    const row = { encrypted, revision: 1, updated_at: 1 };
    for (const [e, o, r] of [
      [env, "someone-else", row],
      [env, owner, { ...row, revision: 2 }],
      [{ ...env, CREDENTIAL_ENCRYPTION_KEYS: undefined }, owner, row],
      [
        env,
        owner,
        {
          ...row,
          encrypted: encrypted.replace('"ciphertext":"', '"ciphertext":"AAAA'),
        },
      ],
    ] as const)
      await expect(decryptConfiguration(e, o, r)).rejects.toThrow(
        "storage is unavailable",
      );
  });
  it("supports key rotation while retaining the previous decrypt key", async () => {
    const old = await encryptConfiguration(env, owner, 1, config);
    env.CREDENTIAL_ENCRYPTION_KEYS = ring("v2");
    expect(
      await decryptConfiguration(env, owner, {
        encrypted: old,
        revision: 1,
        updated_at: 1,
      }),
    ).toEqual(config);
    expect(
      JSON.parse(await encryptConfiguration(env, owner, 2, config))
        .keyId,
    ).toBe("v2");
  });
  const bind = (value: object = {}) =>
    request({
      workspace: workspace(),
      credentialRevision: 1,
      revision: 0,
      confirm: true,
      ...value,
    });
  it("accepts the account's agent without granting its tools or writing to MA", async () => {
    const fetcher = upstream();
    const response = await handle(bind(), env, withAuth(fetcher));
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
    await store.save(config, 0, account(), 1, fetcher);
    expect((await store.save(config, 1, account(), 2, fetcher)).revision).toBe(1);
    await expect(store.save(config, 0, account(), 3, fetcher)).rejects.toThrow("changed");
    expect(
      (
        await store.save(
          replaced(),
          1,
          account(replaced()),
          4,
          fetcher,
        )
      ).revision,
    ).toBe(2);
  });
  it("blocks account/key changes during unresolved work", async () => {
    await store.save(config, 0, account(), 1, upstream());
    const repo = new Repository(env.DB, owner);
    await repo.enqueue("manual:unresolved-test", 2, 2);
    await expect(
      store.save(
        replaced(),
        1,
        account(replaced()),
        3,
        upstream(),
      ),
    ).rejects.toThrow("unresolved");
    expect((await store.status()).revision).toBe(1);
  });
  it("pauses an existing schedule on credential replacement and rejects stale authorization bindings", async () => {
    await store.save(config, 0, account(), 1, upstream());
    const repo = new Repository(env.DB, owner);
    const hash = await new ArkRemote(
      configurationEnv({ ...env, OWNER_ID: owner }, config),
    ).fingerprint();
    const auth = { revision: 1, hash };
    await repo.saveSchedule(
      { enabled: true, timezone: "UTC", local_time: "09:00", revision: 0 },
      1,
      auth,
    );
    await store.save(
      replaced(),
      1,
      account(replaced()),
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
    await store.save(config, 0, account(), 1, upstream());
    const repo = new Repository(env.DB, owner);
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
    expect((await store.save(config, 2, account(), 5, upstream())).revision).toBe(3);
    expect((await repo.schedule()).enabled).toBe(false);
  });
  it("marks uncertain submissions for review and only restores their original connection", async () => {
    await store.save(config, 0, account(), 1, upstream());
    const repo = new Repository(env.DB, owner);
    await repo.enqueue("manual:submitted-test", 2, 2);
    const run = (await repo.claim(2))!;
    await repo.transition(
      run,
      "queued",
      {
        phase: "sending",
        prompt: "private pending prompt",
        connection_hash: await new ArkRemote(
          configurationEnv({ ...env, OWNER_ID: owner }, config),
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
        replaced(),
        2,
        account(replaced()),
        4,
        upstream(),
      ),
    ).rejects.toThrow("unresolved");
    await store.save(config, 2, account(), 5, upstream());
    expect((await repo.runs())[0].phase).toBe("needs_attention");
  });
  it("checks revocation before every subsequent upstream call", async () => {
    await store.save(config, 0, account(), 1, upstream());
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
  it("never falls back to service-level Ark settings", async () => {
    const service = new ConnectionStore(configurationEnv(env, config), owner);
    expect(await service.resolve()).toBeUndefined();
    await store.save(config, 0, account(), 1, upstream());
    await store.remove(1, 2);
    expect(await service.resolve()).toBeUndefined();
  });
  it("keeps removal available without a decrypt key and does not auto-enable generation", async () => {
    await store.save(config, 0, account(), 1, upstream());
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
          withAuth(),
        )
      ).status,
    ).toBe(200);
  });
  it("requires authentication, explicit consent, bounded schemas, and a valid keyring", async () => {
    const ark = upstream(),
      fetcher = withAuth(ark);
    const unauthenticated = bind();
    unauthenticated.headers.delete("Authorization");
    expect((await handle(unauthenticated, env, fetcher)).status).toBe(401);
    for (const value of [
      bind({ confirm: false }),
      bind({ owner: "other" }),
      bind({ credentialRevision: undefined }),
      bind({ workspace: { ...workspace(), apiKey: config.apiKey } }),
      bind({ workspace: { ...workspace(), refreshToken: "secret-sso-token" } }),
      // A full Ark configuration with a key is never accepted.
      request({ config, revision: 0, confirm: true }),
    ])
      expect((await handle(value, env, fetcher)).status).toBe(400);
    expect(
      (
        await handle(
          bind(),
          { ...env, CREDENTIAL_ENCRYPTION_KEYS: undefined },
          fetcher,
        )
      ).status,
    ).toBe(503);
    expect(
      (await handle(request({ data: "a".repeat(9000) }), env, fetcher)).status,
    ).toBe(413);
    expect(ark).not.toHaveBeenCalled();
    expect(await store.row()).toBeNull();
  });
  it("sanitizes upstream errors and does not store rejected configurations", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(config.apiKey);
    });
    const result = await handle(bind(), env, withAuth(fetcher));
    expect(result.status).toBe(422);
    expect(await result.text()).not.toContain(config.apiKey);
    expect(await store.row()).toBeNull();
  });
});
