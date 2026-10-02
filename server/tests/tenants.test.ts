import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { database } from "./database";
import { authenticate } from "../src/auth";
import { handle } from "../src/index";
import { ConnectionStore } from "../src/connection";
import { Repository } from "../src/repository";
import { processRun, tick } from "../src/jobs";
import type { Env } from "../src/env";
import type { Remote } from "../src/ark";
import type { AgentEvent } from "../../shared/types";
import type { BackgroundConfiguration } from "../../shared/background-connection";
import {
  accountEnv,
  arkWorkspaces,
  seedAccount,
  session,
  withAuth,
} from "./accounts";

describe("Per-account background execution isolation", () => {
  let fixture: Awaited<ReturnType<typeof database>>, env: Env;
  let owners: string[], tokens: string[], configs: BackgroundConfiguration[];
  beforeAll(async () => {
    fixture = await database();
  });
  afterAll(async () => fixture.dispose());
  beforeEach(async () => {
    const users = [session(), session()];
    owners = users.map((u) => u.owner);
    tokens = users.map((u) => u.token);
    configs = users.map((u, i) => ({
      apiKey: `test-private-key-${u.id}`,
      project: `project-${i}`,
      agentId: `agent-${u.id}`,
      agentVersion: 1,
      environmentId: `env-${u.id}`,
      memoryStoreId: `memory-${u.id}`,
    }));
    env = accountEnv(fixture.db, {
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("c".repeat(32)) },
      }),
    });
  });
  // Read at call time, so a test may make both accounts share one key.
  const ark: typeof fetch = (input, init) =>
    arkWorkspaces(owners.map((owner, i) => ({ owner, config: configs[i] })))(
      input,
      init,
    );
  const upstream = withAuth(ark);
  // Stores each account's key and records its workspace, as the account flow
  // does before background work can be allowed.
  const seed = () =>
    Promise.all(owners.map((owner, i) => seedAccount(env, owner, configs[i])));
  const workspace = (i: number) => ({
    agentId: configs[i].agentId,
    agentVersion: configs[i].agentVersion,
    environmentId: configs[i].environmentId,
    memoryStoreId: configs[i].memoryStoreId,
  });
  const request = (
    i: number,
    path: string,
    value?: unknown,
    method = "GET",
    token = tokens[i],
  ) =>
    new Request(`https://example.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "per-user-manual-action",
      },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    });
  const bind = (i: number, extra: object = {}) =>
    request(
      i,
      "/v1/connection",
      {
        workspace: workspace(i),
        credentialRevision: 1,
        revision: 0,
        confirm: true,
        ...extra,
      },
      "PUT",
    );
  const setup = async () => {
    await seed();
    for (let i = 0; i < 2; i++)
      expect((await handle(bind(i), env, upstream)).status).toBe(200);
  };
  it("derives ownership from the verified session, ignoring query IDs and body fields", async () => {
    for (let i = 0; i < 2; i++) {
      const r = request(i, `/v1/status?owner=${owners[1 - i]}`);
      expect(await authenticate(r, env, upstream)).toBe(owners[i]);
      expect(await (await handle(r, env, upstream)).json()).toMatchObject({
        owner: owners[i],
      });
    }
    await seed();
    expect(
      (await handle(bind(0, { owner: owners[1] }), env, upstream)).status,
    ).toBe(400);
  });
  it("never falls back to a shared Ark key for missing user credentials", async () => {
    const shared = {
      ...env,
      ARK_API_KEY: configs[0].apiKey,
      ARK_AGENT_ID: configs[0].agentId,
      ARK_AGENT_VERSION: "1",
      ARK_ENVIRONMENT_ID: configs[0].environmentId,
      ARK_MEMORY_STORE_ID: configs[0].memoryStoreId,
    };
    for (const owner of owners)
      expect(
        await new ConnectionStore(shared, owner).resolve(),
      ).toBeUndefined();
  });
  it("includes the end-user identity in task bindings even when the entire Ark configuration matches", async () => {
    const { ArkRemote } = await import("../src/ark");
    const connection = {
      ...env,
      ARK_API_KEY: configs[0].apiKey,
      ARK_AGENT_ID: configs[0].agentId,
      ARK_AGENT_VERSION: "1",
      ARK_ENVIRONMENT_ID: configs[0].environmentId,
      ARK_MEMORY_STORE_ID: configs[0].memoryStoreId,
    };
    const remotes = owners.map(
      (owner) => new ArkRemote({ ...connection, OWNER_ID: owner }),
    );
    expect(await remotes[0].fingerprint()).not.toBe(
      await remotes[1].fingerprint(),
    );
  });
  it("serves one account on several devices independently of Ark credentials", async () => {
    await setup();
    const id = configs[0].agentId.slice("agent-".length);
    const second = session(id, "second-device");
    expect(second.owner).toBe(owners[0]);
    const r = request(0, "/v1/status", undefined, "GET", second.token);
    expect(await authenticate(r, env, upstream)).toBe(owners[0]);
    expect(await (await handle(r, env, upstream)).json()).toMatchObject({
      owner: owners[0],
      connection: { configured: true, revision: 1 },
    });
  });
  it("stores a shared key independently and revokes only the requesting user's connection", async () => {
    configs[1].apiKey = configs[0].apiKey;
    configs[1].project = configs[0].project;
    const bindings = await seed();
    const first = new ConnectionStore(env, owners[0]),
      second = new ConnectionStore(env, owners[1]);
    await first.save(configs[0], 0, bindings[0], 1, ark);
    await second.save(configs[1], 0, bindings[1], 2, ark);
    expect((await first.row())?.encrypted).not.toBe(
      (await second.row())?.encrypted,
    );
    await first.remove(1, 3);
    expect(await first.resolve()).toBeUndefined();
    expect((await second.resolve())?.env).toMatchObject({
      OWNER_ID: owners[1],
      ARK_API_KEY: configs[1].apiKey,
      ARK_MEMORY_STORE_ID: configs[1].memoryStoreId,
    });
    await first.save(configs[0], 2, bindings[0], 4, ark);
    expect((await first.resolve())?.env.OWNER_ID).toBe(owners[0]);
    expect((await second.status()).revision).toBe(1);
  });
  it("permits simultaneous uploads with the same key without merging users", async () => {
    configs[1].apiKey = configs[0].apiKey;
    configs[1].project = configs[0].project;
    const bindings = await seed();
    const a = new ConnectionStore(env, owners[0]),
      b = new ConnectionStore(env, owners[1]);
    const results = await Promise.allSettled([
      a.save(configs[0], 0, bindings[0], 1, ark),
      b.save(configs[1], 0, bindings[1], 1, ark),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const resolved = await Promise.all([a.resolve(), b.resolve()]);
    expect(resolved.map((c) => c?.env.OWNER_ID)).toEqual(owners);
    expect(resolved.map((c) => c?.env.ARK_MEMORY_STORE_ID)).toEqual(
      configs.map((c) => c.memoryStoreId),
    );
    const { ArkRemote } = await import("../src/ark");
    expect(await new ArkRemote(resolved[0]!.env).fingerprint()).not.toBe(
      await new ArkRemote(resolved[1]!.env).fingerprint(),
    );
  });
  it.each([false, true])(
    "isolates jobs and results when users share a key: %s",
    async (sharedKey) => {
      if (sharedKey) {
        configs[1].apiKey = configs[0].apiKey;
        configs[1].project = configs[0].project;
      }
      await setup();
      for (let i = 0; i < 2; i++)
        expect(
          (await handle(request(i, "/v1/runs", { confirm: true }, "POST"), env, upstream))
            .status,
        ).toBe(202);
      let now = Date.now() + 1000;
      const history: AgentEvent[][] = [[], []],
        remotes: Remote[] = owners.map((owner, i) => ({
          owner,
          fingerprint: async () =>
            new ConnectionStore(env, owner).resolve().then(async (c) => {
              const { ArkRemote } = await import("../src/ark");
              return new ArkRemote(c!.env).fingerprint();
            }),
          verify: async () => {},
          prepare: async () => `Private prompt for ${i}`,
          create: vi.fn(async () => `session-${i}`),
          find: async () => [],
          send: vi.fn(async (_session, id) => {
            history[i].push(
              { id, type: "user.message" },
              {
                id: `reply-${i}`,
                type: "agent.message",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      items: [
                        {
                          title: `Private idea ${i}`,
                          body: `Only for user ${i}`,
                          emoji: "🌿",
                          reason: "Personal",
                          category: "Ideas",
                          prompt: "Discuss",
                          sources: [],
                        },
                      ],
                    }),
                  },
                ],
              },
              {
                id: `idle-${i}`,
                type: "session.status_idle",
                stop_reason: { type: "end_turn" },
              },
            );
          }),
          events: async () => history[i],
        }));
      const factory = vi.fn((owner: string, connection: Env) => {
        const i = owners.indexOf(owner);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(connection.OWNER_ID).toBe(owner);
        expect(connection.ARK_API_KEY).toBe(configs[i].apiKey);
        expect(connection.ARK_AGENT_ID).toBe(configs[i].agentId);
        expect(connection.ARK_MEMORY_STORE_ID).toBe(configs[i].memoryStoreId);
        return remotes[i];
      });
      for (let step = 0; step < 3; step++) {
        await tick(env, factory, () => now);
        now += 300000;
      }
      for (let i = 0; i < 2; i++) {
        expect(remotes[i].create).toHaveBeenCalledTimes(1);
        expect(remotes[i].send).toHaveBeenCalledTimes(1);
        const feed = (await (
          await handle(request(i, "/v1/feed"), env, upstream)
        ).json()) as { items: { title: string }[] };
        expect(feed.items.map((item) => item.title)).toEqual([
          `Private idea ${i}`,
        ]);
        const runs = (await (
          await handle(request(i, "/v1/runs"), env, upstream)
        ).json()) as { runs: { phase: string }[] };
        expect(runs.runs).toHaveLength(1);
        expect(runs.runs[0].phase).toBe("complete");
      }
    },
  );
  it("blocks even an accidentally cached wrong-user Ark adapter before claiming a task", async () => {
    await setup();
    const repo = new Repository(env.DB, owners[0]);
    await repo.enqueue("manual:wrong-adapter", 1, 1);
    const wrong = { owner: owners[1], prepare: vi.fn() } as unknown as Remote;
    await expect(processRun(repo, wrong, () => 2)).rejects.toThrow(
      "different users",
    );
    expect(wrong.prepare).not.toHaveBeenCalled();
    expect((await repo.runs())[0].phase).toBe("queued");
  });
  it("cannot recheck another user's run or revoke their connection", async () => {
    await setup();
    const repo = new Repository(env.DB, owners[0]),
      run = await repo.enqueue("manual:private-run", 1, 1);
    expect(
      (
        await handle(
          request(1, `/v1/runs/${run.id}/recheck`, { confirm: true }, "POST"),
          env,
          upstream,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handle(
          request(
            1,
            "/v1/connection",
            { revision: 1, confirm: true },
            "DELETE",
          ),
          env,
          upstream,
        )
      ).status,
    ).toBe(200);
    expect(
      (await new ConnectionStore(env, owners[0]).status()).configured,
    ).toBe(true);
    expect((await repo.runs())[0].phase).toBe("queued");
  });
});
