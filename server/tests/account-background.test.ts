import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { tick } from "../src/jobs";
import { ConnectionStore } from "../src/connection";
import { ArkRemote, type Remote } from "../src/ark";
import { Repository } from "../src/repository";
import { supabaseOwner } from "../../shared/supabase-auth";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import type { Env } from "../src/env";
import type { AgentEvent } from "../../shared/types";
import type { BackgroundWorkspace } from "../../shared/background-connection";

const origin = "https://auth.example.com";
const sharedKey = "test-shared-ark-api-key-0001";
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
  "carol-access-token-000000001": "9b1f0c8e-5d2a-4c3e-8f7a-1e2d3c4b5a69",
  "dave-access-token-0000000001": "2c4e6a8b-1d3f-4a5c-9e7b-0f1a2b3c4d5e",
  "erin-access-token-0000000001": "7e5d3c1b-9a8f-4e6d-8c4b-2a1f0e9d8c7b",
};
const tokens = Object.keys(users);
const owners = tokens.map((token) => supabaseOwner(origin, users[token]));
const [ALICE, BOB, CAROL, DAVE, ERIN] = [0, 1, 2, 3, 4];
const labelFor = (i: number) => accountWorkspaceKey(sharedKey, "", owners[i]);
const workspaces: BackgroundWorkspace[] = [];

// A read/write Ark account behind one shared key: every holder of the key can
// read, create, and relabel every resource, as with real Ark.
type Resource = { id: string; metadata: Record<string, string> };
const ark: Record<string, Record<string, Resource>> = {
  agents: {},
  environments: {},
  memory_stores: {},
};
let sequence = 0;
// Makes the next creation fail before or after Ark stored the resource.
let failNextCreate: "before" | "after" | undefined;
const upstream = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input));
  const bearer = (new Headers(init?.headers).get("Authorization") ?? "").slice(
    7,
  );
  if (url.origin === origin) {
    const id = users[bearer];
    return id
      ? Response.json({ id, is_anonymous: false })
      : Response.json({}, { status: 401 });
  }
  if (bearer !== sharedKey) return Response.json({}, { status: 401 });
  const [, collection, id] = url.pathname.replace("/api/v3", "").split("/");
  const rows = ark[collection];
  if (!rows) return Response.json({ data: [] });
  if ((init?.method ?? "GET") === "POST" && !id) {
    const failure = failNextCreate;
    failNextCreate = undefined;
    if (failure === "before") throw new TypeError("network down");
    const body = JSON.parse(String(init!.body));
    const row = { id: `${collection}-${++sequence}`, metadata: body.metadata };
    rows[row.id] = row;
    if (failure === "after") throw new TypeError("response lost");
    return Response.json(row);
  }
  expect(init?.method ?? "GET").toBe("GET");
  if (!id) return Response.json({ data: Object.values(rows) });
  const row = rows[id];
  if (!row) return Response.json({}, { status: 404 });
  return Response.json(
    collection === "agents" ? { ...row, version: 1, tools: [] } : row,
  );
});
const reads = (ids: string[]) =>
  upstream.mock.calls.filter(([input]) =>
    ids.some((id) => String(input).endsWith(`/${id}`)),
  ).length;
const request = (i: number, path: string, body?: unknown, method = "GET") =>
  handle(
    new Request(`https://background.example${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokens[i]}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `manual-action-for-user-${i}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    upstream,
  );
const saveKey = (i: number, revision = 0) =>
  request(
    i,
    "/v1/account/credential",
    { credential: { apiKey: sharedKey, project: "" }, revision, confirm: true },
    "PUT",
  );
const provision = (i: number, extra: object = {}) =>
  request(
    i,
    "/v1/account/workspace",
    { credentialRevision: 1, confirm: true, ...extra },
    "POST",
  );
const bind = (i: number, workspace: BackgroundWorkspace, revision = 0) =>
  request(
    i,
    "/v1/connection",
    { workspace, credentialRevision: 1, revision, confirm: true },
    "PUT",
  );
async function provisioned(i: number) {
  const response = await provision(i);
  expect(response.status).toBe(200);
  const { workspace } = (await response.json()) as {
    workspace: Omit<BackgroundWorkspace, "agentVersion"> & { model: string };
  };
  const { agentId, environmentId, memoryStoreId } = workspace;
  return { agentId, environmentId, memoryStoreId, agentVersion: 1 };
}
let env: Env;

describe("Background work for Open Muse account workspaces", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      OWNER_ID: "private-owner",
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("d".repeat(32)) },
      }),
      // The service-level key must never be borrowed by an account.
      ARK_API_KEY: "service-level-private-key",
      ARK_AGENT_ID: "service-agent",
      ARK_AGENT_VERSION: "1",
      ARK_ENVIRONMENT_ID: "service-env",
      ARK_MEMORY_STORE_ID: "service-memory",
    };
  });
  afterAll(async () => fixture.dispose());

  it("requires the account's own stored key before anything is prepared or bound", async () => {
    const status = await (await request(ALICE, "/v1/status")).json();
    expect(status).toMatchObject({
      owner: owners[ALICE],
      backgroundReady: false,
      credentialStorageReady: true,
      account: { provider: "supabase", credential: { configured: false } },
    });
    expect((await provision(ALICE)).status).toBe(409);
    const placeholder = {
      agentId: "agent-x",
      agentVersion: 1,
      environmentId: "env-x",
      memoryStoreId: "memory-x",
    };
    expect((await bind(ALICE, placeholder)).status).toBe(409);
    expect(
      (await request(ALICE, "/v1/runs", { confirm: true }, "POST")).status,
    ).toBe(409);
  });

  it("never accepts an Ark key in an account workspace binding", async () => {
    const response = await request(
      ALICE,
      "/v1/connection",
      {
        workspace: { agentId: "a", apiKey: "attacker-chosen-key-000" },
        credentialRevision: 1,
        revision: 0,
        confirm: true,
      },
      "PUT",
    );
    expect(response.status).toBe(400);
  });

  it("creates, labels, records, and seals each account's own workspace", async () => {
    for (const i of [ALICE, BOB]) {
      expect((await saveKey(i)).status).toBe(200);
      workspaces[i] = await provisioned(i);
      for (const [collection, id, label] of [
        ["agents", workspaces[i].agentId, "open_muse_workspace"],
        ["environments", workspaces[i].environmentId, "open_muse_workspace"],
        ["memory_stores", workspaces[i].memoryStoreId, "open_muse_identity"],
      ])
        expect(ark[collection][id].metadata[label]).toBe(labelFor(i));
      // Every device of the account reads the same sealed configuration.
      expect(
        await (await request(i, "/v1/account/workspace")).json(),
      ).toMatchObject({ workspace: { agentId: workspaces[i].agentId } });
    }
    expect(workspaces[ALICE].agentId).not.toBe(workspaces[BOB].agentId);
    const sealed = await env.DB.prepare(
      "SELECT encrypted FROM account_workspaces",
    ).all<{ encrypted: string }>();
    for (const row of sealed.results)
      for (const w of workspaces)
        expect(row.encrypted).not.toContain(w.memoryStoreId);
    // Provisioning again only checks the recorded resources.
    const creates = Object.values(ark).flatMap(Object.keys).length;
    expect((await provision(ALICE)).status).toBe(200);
    expect(Object.values(ark).flatMap(Object.keys).length).toBe(creates);
  });

  it("runs each account's work with its own agent when both share one Ark key", async () => {
    for (const i of [ALICE, BOB]) {
      expect((await bind(i, workspaces[i])).status).toBe(200);
      expect(await (await request(i, "/v1/status")).json()).toMatchObject({
        backgroundReady: true,
        account: { credential: { configured: true, revision: 1 } },
      });
      expect(
        (await request(i, "/v1/runs", { confirm: true }, "POST")).status,
      ).toBe(202);
    }
    const history: AgentEvent[][] = [[], []];
    const remotes: Remote[] = [ALICE, BOB].map((i) => ({
      owner: owners[i],
      fingerprint: async () =>
        new ArkRemote(
          (await new ConnectionStore(env, owners[i]).resolve())!.env,
        ).fingerprint(),
      verify: async () => {},
      prepare: async () => `Private prompt for ${i}`,
      create: vi.fn(async () => `session-${i}`),
      find: async () => [],
      send: vi.fn(async (_session: string, id: string) => {
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
                      body: `Only for account ${i}`,
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
      expect([ALICE, BOB]).toContain(i);
      expect(connection.OWNER_ID).toBe(owner);
      expect(connection.ARK_API_KEY).toBe(sharedKey);
      expect(connection.ARK_AGENT_ID).toBe(workspaces[i].agentId);
      expect(connection.ARK_MEMORY_STORE_ID).toBe(workspaces[i].memoryStoreId);
      return remotes[i];
    });
    let now = Date.now() + 1000;
    for (let step = 0; step < 3; step++) {
      await tick(env, factory, () => now);
      now += 300000;
    }
    for (const i of [ALICE, BOB]) {
      expect(remotes[i].create).toHaveBeenCalledTimes(1);
      expect(remotes[i].send).toHaveBeenCalledTimes(1);
      const feed = (await (await request(i, "/v1/feed")).json()) as {
        items: { title: string }[];
      };
      expect(feed.items.map((item) => item.title)).toEqual([
        `Private idea ${i}`,
      ]);
    }
  });

  it("refuses another account's resources before reading them, even after relabelling", async () => {
    const alice = workspaces[ALICE];
    const ids = [alice.agentId, alice.environmentId, alice.memoryStoreId];
    const steal = (workspace: BackgroundWorkspace) => bind(BOB, workspace, 1);
    const before = reads(ids);
    expect((await steal(alice)).status).toBe(403);
    for (const mixed of [
      { ...workspaces[BOB], memoryStoreId: alice.memoryStoreId },
      { ...workspaces[BOB], environmentId: alice.environmentId },
      { ...workspaces[BOB], agentId: alice.agentId },
    ])
      expect((await steal(mixed)).status).toBe(403);
    // Bob relabels Alice's resources with his own label outside Open Muse.
    ark.agents[alice.agentId].metadata.open_muse_workspace = labelFor(BOB);
    ark.environments[alice.environmentId].metadata.open_muse_workspace =
      labelFor(BOB);
    ark.memory_stores[alice.memoryStoreId].metadata.open_muse_identity =
      labelFor(BOB);
    try {
      expect((await steal(alice)).status).toBe(403);
      // Bob's own workspace request still returns only what was created
      // for Bob; nothing is discovered by label.
      expect(await (await provision(BOB)).json()).toMatchObject({
        workspace: { memoryStoreId: workspaces[BOB].memoryStoreId },
      });
    } finally {
      ark.agents[alice.agentId].metadata.open_muse_workspace = labelFor(ALICE);
      ark.environments[alice.environmentId].metadata.open_muse_workspace =
        labelFor(ALICE);
      ark.memory_stores[alice.memoryStoreId].metadata.open_muse_identity =
        labelFor(ALICE);
    }
    // No request read Alice's resources on Bob's behalf.
    expect(reads(ids)).toBe(before);
    const bob = await new ConnectionStore(env, owners[BOB]).resolve();
    expect(bob?.env.ARK_MEMORY_STORE_ID).toBe(workspaces[BOB].memoryStoreId);
  });

  it("gives accounts preparing at the same time separate resources", async () => {
    for (const i of [CAROL, DAVE]) expect((await saveKey(i)).status).toBe(200);
    const [carol, dave] = await Promise.all([
      provisioned(CAROL),
      provisioned(DAVE),
    ]);
    workspaces[CAROL] = carol;
    workspaces[DAVE] = dave;
    for (const kind of ["agentId", "environmentId", "memoryStoreId"] as const)
      expect(carol[kind]).not.toBe(dave[kind]);
    const recorded = await env.DB.prepare(
      "SELECT resource_id,owner_id FROM account_resources WHERE owner_id IN (?,?)",
    )
      .bind(owners[CAROL], owners[DAVE])
      .all<{ resource_id: string; owner_id: string }>();
    expect(recorded.results).toHaveLength(6);
    for (const row of recorded.results)
      expect(row.owner_id).toBe(
        Object.values(carol).includes(row.resource_id)
          ? owners[CAROL]
          : owners[DAVE],
      );
  });

  it("never adopts a resource whose creation was unconfirmed", async () => {
    expect((await saveKey(ERIN)).status).toBe(200);
    // Lost before Ark stored anything: the next attempt checks, finds
    // nothing, and creates once.
    failNextCreate = "before";
    expect((await provision(ERIN)).status).toBe(503);
    expect((await provision(ERIN)).status).toBe(200);
    // Delete the recorded agent so the next attempt must create one.
    const first = (await (
      await request(ERIN, "/v1/account/workspace")
    ).json()) as { workspace: { agentId: string } };
    delete ark.agents[first.workspace.agentId];
    failNextCreate = "after";
    expect((await provision(ERIN)).status).toBe(503);
    const orphan = Object.values(ark.agents).at(-1)!;
    expect(orphan.metadata.open_muse_workspace).toBe(labelFor(ERIN));
    // The resource exists but is never used, not even by its creator.
    const agents = Object.keys(ark.agents).length;
    expect((await provision(ERIN)).status).toBe(409);
    expect((await provision(ERIN)).status).toBe(409);
    expect(Object.keys(ark.agents).length).toBe(agents);
    // Only an explicit decision replaces it with a new resource.
    const replaced = await provision(ERIN, { replaceUnconfirmed: true });
    expect(replaced.status).toBe(200);
    const { workspace } = (await replaced.json()) as {
      workspace: { agentId: string };
    };
    expect(workspace.agentId).not.toBe(orphan.id);
    expect(
      await env.DB.prepare(
        "SELECT owner_id FROM account_resources WHERE resource_id=?",
      )
        .bind(orphan.id)
        .first(),
    ).toBeNull();
  });

  it("stops when a recorded resource is changed outside Open Muse", async () => {
    const agent = ark.agents[workspaces[CAROL].agentId];
    agent.metadata.open_muse_workspace = labelFor(DAVE);
    try {
      expect((await provision(CAROL)).status).toBe(409);
    } finally {
      agent.metadata.open_muse_workspace = labelFor(CAROL);
    }
  });

  it("limits how many resources one account can create", async () => {
    await env.DB.prepare(
      "UPDATE account_rate_limits SET count=20,window_start=? WHERE owner_id=?",
    )
      .bind(Date.now(), owners[DAVE])
      .run();
    delete ark.memory_stores[
      (
        (await (await request(DAVE, "/v1/account/workspace")).json()) as {
          workspace: { memoryStoreId: string };
        }
      ).workspace.memoryStoreId
    ];
    const stores = Object.keys(ark.memory_stores).length;
    expect((await provision(DAVE)).status).toBe(429);
    expect(Object.keys(ark.memory_stores).length).toBe(stores);
  });

  it("schedules only accounts active under the configured issuer", async () => {
    for (const i of [ALICE, BOB]) {
      const connection = (await new ConnectionStore(env, owners[i]).resolve())!;
      await new Repository(env.DB, owners[i]).enqueue(
        `manual:activity-${i}`,
        1,
        Date.now(),
        false,
        {
          revision: connection.revision,
          hash: await new ArkRemote(connection.env).fingerprint(),
        },
      );
    }
    // Only records which owners are selected; the run itself is not needed.
    const seen = vi.fn((_owner: string): Remote => {
      throw new Error("selected");
    });
    await env.DB.prepare(
      "UPDATE account_credentials SET last_seen_at=0 WHERE owner_id=?",
    )
      .bind(owners[ALICE])
      .run();
    await tick(env, seen, () => Date.now() + 1000);
    expect(seen.mock.calls.map(([owner]) => owner)).toEqual([owners[BOB]]);
    seen.mockClear();
    await tick(
      { ...env, SUPABASE_AUTH_URL: "https://other-auth.example.com" },
      seen,
      () => Date.now() + 1000,
    );
    expect(seen).not.toHaveBeenCalled();
    // A verified request renews Alice's activity.
    expect((await request(ALICE, "/v1/status")).status).toBe(200);
    await tick(env, seen, () => Date.now() + 1000);
    expect(seen.mock.calls.map(([owner]) => owner).sort()).toEqual(
      [owners[ALICE], owners[BOB]].sort(),
    );
  });

  it("rotating one account's key stops only that account's background access", async () => {
    const store = new ConnectionStore(env, owners[ALICE]);
    const before = (await store.resolve())!;
    const inflight = store.guardedFetch(before.revision, upstream);
    const rotate = await request(
      ALICE,
      "/v1/account/credential",
      {
        credential: { apiKey: sharedKey, project: "other-project" },
        revision: 1,
        confirm: true,
      },
      "PUT",
    );
    expect(rotate.status).toBe(200);
    // Work that resolved the old binding cannot send another MA request.
    upstream.mockClear();
    await expect(
      inflight("https://ark.cn-beijing.volces.com/api/v3/sessions", {
        method: "POST",
      }),
    ).rejects.toThrow("Background authorization changed");
    expect(upstream).not.toHaveBeenCalled();
    expect(await (await request(ALICE, "/v1/status")).json()).toMatchObject({
      backgroundReady: false,
      connection: { configured: false },
    });
    expect(await (await request(BOB, "/v1/status")).json()).toMatchObject({
      backgroundReady: true,
    });
    // A binding prepared for the previous key revision is refused.
    const stale = await request(
      ALICE,
      "/v1/connection",
      {
        workspace: workspaces[ALICE],
        credentialRevision: 1,
        revision: 2,
        confirm: true,
      },
      "PUT",
    );
    expect(stale.status).toBe(409);
  });
});
