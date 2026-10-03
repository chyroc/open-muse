import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { ConnectionStore, seal } from "../src/connection";
import { ACCOUNT_TABLES } from "../src/account-deletion";
import type { Env } from "../src/env";
import {
  accountEnv,
  arkWorkspaces,
  seedAccount,
  session,
  withAuth,
} from "./accounts";

const config = (n: number) => ({
  apiKey: `test-ark-key-for-export-${n}-00000wxyz${n}`,
  project: `project-${n}`,
  agentId: `agent-x${n}`,
  agentVersion: 1,
  environmentId: `env-x${n}`,
  memoryStoreId: `memory-x${n}`,
});

describe("Exporting an Open Muse account's data", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const auth = withAuth();
  const [alice, bob] = [session(), session()];
  const call = (
    token: string | null,
    path = "/v1/account/export",
    target = env,
  ) =>
    handle(
      new Request(`https://background.example${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      target,
      auth,
    );
  beforeAll(async () => {
    fixture = await database();
    env = accountEnv(fixture.db, {
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("e".repeat(32)) },
      }),
    });
    const now = Date.now();
    for (const [user, n] of [
      [alice, 1],
      [bob, 2],
    ] as const) {
      const workspace = config(n);
      const binding = await seedAccount(env, user.owner, workspace, now);
      await new ConnectionStore(env, user.owner).save(
        workspace,
        0,
        binding,
        now,
        arkWorkspaces([{ owner: user.owner, config: workspace }]),
      );
      const device = crypto.randomUUID();
      const registered = await handle(
        new Request(`https://background.example/v1/account/devices/${device}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${user.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `Device of person ${n}`,
            platform: "ios",
            app_version: "0.2.0",
          }),
        }),
        env,
        auth,
      );
      expect(registered.status).toBe(200);
      const run = `run-${n}`;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO account_workspaces(owner_id,workspace_key,revision,encrypted,pending,updated_at,mutation_id)
          VALUES (?,?,1,?,NULL,?,'m')`,
        ).bind(
          user.owner,
          binding.workspaceKey,
          await seal(env, "open-muse-account-workspace", user.owner, 1, {
            workspaceKey: binding.workspaceKey,
            workspace: { agentId: workspace.agentId, model: `model-${n}` },
          }),
          now,
        ),
        env.DB.prepare(
          "INSERT INTO schedules(owner_id,enabled,timezone,local_time,next_run_at,revision,updated_at) VALUES (?,0,'Asia/Shanghai','08:30',NULL,2,?)",
        ).bind(user.owner, now),
        env.DB.prepare(
          `INSERT INTO runs(id,owner_id,request_key,scheduled_for,phase,marker,event_id,session_id,prompt,lease_token,connection_hash,next_check_at,created_at,updated_at)
          VALUES (?,?,?,?,'running',?,?,'sesn-1','private pending prompt','private-lease','private-fingerprint',?,?,?)`,
        ).bind(
          run,
          user.owner,
          `manual:${run}`,
          now,
          `marker-${n}`,
          `event-${n}`,
          now,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO feed_items(id,owner_id,run_id,session_id,event_id,position,content,created_at)
          VALUES (?,?,?,'sesn-1',?,0,?,?)`,
        ).bind(
          `feed-${n}`,
          user.owner,
          run,
          `event-${n}`,
          JSON.stringify({ title: `Idea ${n}` }),
          now,
        ),
        env.DB.prepare(
          `INSERT INTO upcoming_targets(owner_id,session_id,language,enabled,since,revision,state,next_check_at,updated_at)
          VALUES (?,'sesn-main','en',1,?,1,'active',?,?)`,
        ).bind(user.owner, now, now, now),
        env.DB.prepare(
          "INSERT INTO upcoming_messages(event_id,owner_id,session_id,phase,created_at,updated_at) VALUES (?,?,'sesn-main','sent',?,?)",
        ).bind(`up-${n}`, user.owner, now, now),
        env.DB.prepare(
          "INSERT INTO upcoming_deliveries(owner_id,item_id,occurrence_at,event_id) VALUES (?,'item-1',?,?)",
        ).bind(user.owner, now, `up-${n}`),
        env.DB.prepare(
          `INSERT INTO proactive_claims(owner_id,kind,claim_key,session_id,claimant,claim_id,created_at,expires_at)
          VALUES (?,'checkin','2026-10-03','sesn-main','app',?,?,?)`,
        ).bind(user.owner, `claim-${n}`, now, now + 60_000),
        env.DB.prepare(
          `INSERT INTO browser_views(view_id,owner_id,token_hash,created_at,expires_at,closed,frame_seq,frame,input_seq)
          VALUES (?,?,'private-token-hash',?,?,0,1,'private-frame',0)`,
        ).bind(`view-${n}`, user.owner, now, now + 60_000),
      ]);
    }
  });
  afterAll(async () => fixture?.dispose());

  it("requires a verified account session", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("not-a-session")).status).toBe(401);
  });

  it("returns everything kept for the account, decrypted, without the key or secrets", async () => {
    const res = await call(alice.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ format: 1, owner: alice.owner });
    expect(doc.exportedAt).toEqual(expect.any(Number));
    expect(doc.truncated).toBeUndefined();
    expect(Object.keys(doc.tables)).toEqual([...ACCOUNT_TABLES]);
    const t = doc.tables;
    expect(t.account_credentials).toEqual([
      expect.objectContaining({
        configured: true,
        revision: 1,
        credential: { project: "project-1", api_key_last4: "xyz1" },
      }),
    ]);
    expect(t.ark_connections[0]).toMatchObject({
      configured: true,
      revision: 1,
      workspace: {
        project: "project-1",
        agentId: "agent-x1",
        agentVersion: 1,
        environmentId: "env-x1",
        memoryStoreId: "memory-x1",
      },
    });
    expect(t.account_workspaces[0].workspace).toEqual({
      agentId: "agent-x1",
      model: "model-1",
    });
    expect(t.account_devices[0]).toMatchObject({
      name: "Device of person 1",
      platform: "ios",
    });
    expect(t.schedules[0]).toMatchObject({
      timezone: "Asia/Shanghai",
      local_time: "08:30",
    });
    expect(t.runs[0]).toMatchObject({ id: "run-1", phase: "running" });
    expect(t.feed_items[0].content).toEqual({ title: "Idea 1" });
    expect(t.upcoming_targets[0]).toMatchObject({ session_id: "sesn-main" });
    expect(t.upcoming_messages[0]).toMatchObject({ event_id: "up-1" });
    expect(t.upcoming_deliveries[0]).toMatchObject({ item_id: "item-1" });
    expect(t.account_resources).toHaveLength(3);
    expect(t.proactive_claims).toEqual([
      {
        kind: "checkin",
        claim_key: "2026-10-03",
        session_id: "sesn-main",
        claimant: "app",
        created_at: expect.any(Number),
        expires_at: expect.any(Number),
      },
    ]);
    expect(t.browser_views[0]).toMatchObject({
      view_id: "view-1",
      frame: "omitted",
    });
    // Never the key, a sealed envelope, or another account's data.
    for (const hidden of [
      config(1).apiKey,
      config(2).apiKey,
      bob.owner,
      "Device of person 2",
      "private",
      '"keyId"',
      "owner_id",
    ])
      expect(text).not.toContain(hidden);
  });

  it("exports tables without a handler generically, keeping sealed values sealed", async () => {
    await env.DB.prepare(
      "CREATE TABLE export_probe (owner_id TEXT NOT NULL, note TEXT, encrypted TEXT, claim_token TEXT, wrapped TEXT)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO export_probe(owner_id,note,encrypted,claim_token,wrapped) VALUES (?,'kept',?,'private-claim',?)",
    )
      .bind(
        alice.owner,
        await seal(env, "open-muse-account-ark", alice.owner, 1, "x"),
        await seal(env, "open-muse-account-ark", alice.owner, 2, "y"),
      )
      .run();
    const tables = ACCOUNT_TABLES as unknown as string[];
    tables.push("export_probe");
    try {
      const doc = (await (await call(alice.token)).json()) as {
        tables: Record<string, unknown>;
      };
      expect(doc.tables.export_probe).toEqual([
        { note: "kept", encrypted: "sealed", wrapped: "sealed" },
      ]);
    } finally {
      tables.pop();
      await env.DB.prepare("DROP TABLE export_probe").run();
    }
  });

  it("still exports when the keyring cannot open sealed values", async () => {
    const res = await call(alice.token, "/v1/account/export", {
      ...env,
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v9",
        keys: { v9: btoa("z".repeat(32)) },
      }),
    });
    expect(res.status).toBe(200);
    const { tables } = (await res.json()) as {
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(tables.account_credentials[0].credential).toBe("unavailable");
    expect(tables.ark_connections[0].workspace).toBe("unavailable");
    expect(tables.account_devices[0].name).toBe("unavailable");
  });
});
