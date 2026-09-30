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
};
const tokens = Object.keys(users);
const owners = tokens.map((token) => supabaseOwner(origin, users[token]));
const workspaces: BackgroundWorkspace[] = [0, 1].map((i) => ({
  agentId: `agent-${i}`,
  agentVersion: 1,
  environmentId: `env-${i}`,
  memoryStoreId: `memory-${i}`,
}));
// Ownership labels each account's own client assigns when provisioning. Tests
// may change them to model a key holder tampering outside Open Muse.
const labels = workspaces.map((_, i) =>
  accountWorkspaceKey(sharedKey, "", owners[i]),
);

// Auth verification plus a read-only Ark that knows both users' resources
// under one shared key, as a real Ark account would.
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
  expect(init?.method ?? "GET").toBe("GET");
  if (bearer !== sharedKey) return Response.json({}, { status: 401 });
  const path = url.pathname.replace("/api/v3", "");
  if (path === "/agents") return Response.json({ data: [] });
  for (const [i, w] of workspaces.entries()) {
    const workspace = { open_muse_workspace: labels[i] };
    if (path === `/agents/${w.agentId}`)
      return Response.json({
        id: w.agentId,
        version: 1,
        tools: [],
        metadata: workspace,
      });
    if (path === `/environments/${w.environmentId}`)
      return Response.json({ id: w.environmentId, metadata: workspace });
    if (path === `/memory_stores/${w.memoryStoreId}`)
      return Response.json({
        id: w.memoryStoreId,
        metadata: { open_muse_identity: labels[i] },
      });
  }
  return Response.json({}, { status: 404 });
});
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
let env: Env;

describe("Background work for Muse account workspaces", () => {
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

  it("requires the account's own stored key before background work is ready", async () => {
    const status = await (await request(0, "/v1/status")).json();
    expect(status).toMatchObject({
      owner: owners[0],
      backgroundReady: false,
      credentialStorageReady: true,
      account: { provider: "supabase", credential: { configured: false } },
    });
    const bind = await request(
      0,
      "/v1/connection",
      {
        workspace: workspaces[0],
        credentialRevision: 0,
        revision: 0,
        confirm: true,
      },
      "PUT",
    );
    expect(bind.status).toBe(409);
    expect(
      (await request(0, "/v1/runs", { confirm: true }, "POST")).status,
    ).toBe(409);
  });

  it("never accepts an Ark key in an account workspace binding", async () => {
    const response = await request(
      0,
      "/v1/connection",
      {
        workspace: { ...workspaces[0], apiKey: "attacker-chosen-key-000" },
        credentialRevision: 1,
        revision: 0,
        confirm: true,
      },
      "PUT",
    );
    expect(response.status).toBe(400);
  });

  it("runs each account's work with its own agent when both share one Ark key", async () => {
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await request(
            i,
            "/v1/account/credential",
            {
              credential: { apiKey: sharedKey, project: "" },
              revision: 0,
              confirm: true,
            },
            "PUT",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            i,
            "/v1/connection",
            {
              workspace: workspaces[i],
              credentialRevision: 1,
              revision: 0,
              confirm: true,
            },
            "PUT",
          )
        ).status,
      ).toBe(200);
      expect(await (await request(i, "/v1/status")).json()).toMatchObject({
        backgroundReady: true,
        account: { credential: { configured: true, revision: 1 } },
      });
      expect(
        (await request(i, "/v1/runs", { confirm: true }, "POST")).status,
      ).toBe(202);
    }
    const history: AgentEvent[][] = [[], []];
    const remotes: Remote[] = owners.map((owner, i) => ({
      owner,
      fingerprint: async () =>
        new ArkRemote(
          (await new ConnectionStore(env, owner).resolve())!.env,
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
      expect(i).toBeGreaterThanOrEqual(0);
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
    for (let i = 0; i < 2; i++) {
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

  it("refuses to bind another account's workspace even though the key can read it", async () => {
    const steal = () =>
      request(
        1,
        "/v1/connection",
        {
          workspace: workspaces[0],
          credentialRevision: 1,
          revision: 1,
          confirm: true,
        },
        "PUT",
      );
    const refused = await steal();
    expect(refused.status).toBe(403);
    // Relabelling Alice's resources outside Open Muse still cannot move them:
    // the Worker already recorded Alice as their only owner.
    const original = labels[0];
    labels[0] = labels[1];
    try {
      expect((await steal()).status).toBe(403);
    } finally {
      labels[0] = original;
    }
    const bob = await new ConnectionStore(env, owners[1]).resolve();
    expect(bob?.env.ARK_AGENT_ID).toBe(workspaces[1].agentId);
    expect(bob?.env.ARK_MEMORY_STORE_ID).toBe(workspaces[1].memoryStoreId);
  });

  it("schedules only accounts active under the configured issuer", async () => {
    for (let i = 0; i < 2; i++) {
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
      .bind(owners[0])
      .run();
    await tick(env, seen, () => Date.now() + 1000);
    expect(seen.mock.calls.map(([owner]) => owner)).toEqual([owners[1]]);
    seen.mockClear();
    await tick(
      { ...env, SUPABASE_AUTH_URL: "https://other-auth.example.com" },
      seen,
      () => Date.now() + 1000,
    );
    expect(seen).not.toHaveBeenCalled();
    // A verified request renews Alice's activity.
    expect((await request(0, "/v1/status")).status).toBe(200);
    await tick(env, seen, () => Date.now() + 1000);
    expect(seen.mock.calls.map(([owner]) => owner).sort()).toEqual(
      [...owners].sort(),
    );
  });

  it("rotating one account's key stops only that account's background access", async () => {
    const rotate = await request(
      0,
      "/v1/account/credential",
      {
        credential: { apiKey: sharedKey, project: "other-project" },
        revision: 1,
        confirm: true,
      },
      "PUT",
    );
    expect(rotate.status).toBe(200);
    expect(await (await request(0, "/v1/status")).json()).toMatchObject({
      backgroundReady: false,
      connection: { configured: false },
    });
    expect(await (await request(1, "/v1/status")).json()).toMatchObject({
      backgroundReady: true,
    });
    // A binding prepared for the previous key revision is refused.
    const stale = await request(
      0,
      "/v1/connection",
      {
        workspace: workspaces[0],
        credentialRevision: 1,
        revision: 2,
        confirm: true,
      },
      "PUT",
    );
    expect(stale.status).toBe(409);
  });
});
