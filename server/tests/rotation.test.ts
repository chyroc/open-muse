import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import {
  credentialStorageReady,
  currentKeyId,
  seal,
  unseal,
  type SealPurpose,
} from "../src/connection";
import {
  pendingRewrap,
  rewrapRetiredKeys,
  SEALED_COLUMNS,
} from "../src/rotation";
import type { Env } from "../src/env";
import { triggerHeaders } from "../deploy/volcengine/scheduler/trigger.mjs";

const ring = (current: string, keys: Record<string, string>) =>
  JSON.stringify({ current, keys });
const k1 = btoa("1".repeat(32)),
  k2 = btoa("2".repeat(32)),
  k3 = btoa("3".repeat(32));
const owner = "muse_user_" + "c".repeat(64);
const secret = "test-trigger-secret-".repeat(3);

describe("Keyring rotation without the deployed key's value", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let base: Env;
  beforeAll(async () => {
    fixture = await database();
    base = {
      DB: fixture.db,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v1", { v1: k1 }),
      SCHEDULER_SOURCE: "external",
      SCHEDULER_TRIGGER_SECRET: secret,
    };
  });
  afterAll(async () => fixture?.dispose());

  it("seals with NEXT's current key and still opens the deployed keys", async () => {
    const old = await seal(base, "open-muse-account-ark", owner, 1, "value");
    const rotating = {
      ...base,
      CREDENTIAL_ENCRYPTION_KEYS_NEXT: ring("v2", { v2: k2 }),
    };
    expect(currentKeyId(rotating)).toBe("v2");
    expect(await unseal(rotating, "open-muse-account-ark", owner, 1, old)).toBe(
      "value",
    );
    const fresh = await seal(rotating, "open-muse-account-ark", owner, 1, "x");
    expect(JSON.parse(fresh).keyId).toBe("v2");
    // After the swap, NEXT's keyring alone opens the new values.
    const swapped = {
      ...base,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v2", { v2: k2 }),
    };
    expect(
      await unseal(swapped, "open-muse-account-ark", owner, 1, fresh),
    ).toBe("x");
    // The same key may appear in both keyrings.
    expect(
      credentialStorageReady({
        ...base,
        CREDENTIAL_ENCRYPTION_KEYS_NEXT: ring("v2", { v1: k1, v2: k2 }),
      }),
    ).toBe(true);
  });

  it("fails closed for a colliding key ID or an invalid NEXT keyring", async () => {
    const old = await seal(base, "open-muse-account-ark", owner, 1, "value");
    for (const next of [
      ring("v1", { v1: k2 }),
      ring("v2", { v1: k3, v2: k2 }),
      "not json",
      ring("v2", { v3: k3 }),
      ring("v2", { v2: btoa("short") }),
    ]) {
      const env = { ...base, CREDENTIAL_ENCRYPTION_KEYS_NEXT: next };
      expect(credentialStorageReady(env)).toBe(false);
      expect(currentKeyId(env)).toBeUndefined();
      await expect(
        unseal(env, "open-muse-account-ark", owner, 1, old),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        seal(env, "open-muse-account-ark", owner, 1, "x"),
      ).rejects.toMatchObject({ status: 503 });
    }
    // An empty NEXT is the same as none.
    expect(
      credentialStorageReady({ ...base, CREDENTIAL_ENCRYPTION_KEYS_NEXT: "" }),
    ).toBe(true);
  });

  it("reseals every sealed table from the scheduler tick in bounded batches", async () => {
    const db = base.DB;
    const sealed = (purpose: SealPurpose, revision: number, value: unknown) =>
      seal(base, purpose, owner, revision, value);
    const now = Date.now();
    const statements = [];
    for (let i = 0; i < 3; i++) {
      const id = `00000000-0000-4000-8000-00000000000${i}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO account_devices(owner_id,device_id,platform,app_version,revision,encrypted,created_at,last_seen_at)
            VALUES (?,?,'ios','1',1,?,?,?)`,
          )
          .bind(
            owner,
            id,
            await sealed("open-muse-account-device", 1, {
              id,
              name: `Phone ${i}`,
            }),
            now,
            now,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO account_credentials(owner_id,revision,encrypted,updated_at,mutation_id) VALUES (?,2,?,?,'m')",
        )
        .bind(
          owner,
          await sealed("open-muse-account-ark", 2, {
            apiKey: "k",
            project: "",
          }),
          now,
        ),
      db
        .prepare(
          "INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id) VALUES (?,3,?,?,'m')",
        )
        .bind(
          owner,
          await sealed("open-muse-ark-connection", 3, { c: 1 }),
          now,
        ),
      db
        .prepare(
          "INSERT INTO account_workspaces(owner_id,workspace_key,revision,encrypted,updated_at,mutation_id) VALUES (?,'wk',4,?,?,'m')",
        )
        .bind(
          owner,
          await sealed("open-muse-account-workspace", 4, { w: 1 }),
          now,
        ),
      db
        .prepare(
          `INSERT INTO browser_views(view_id,owner_id,token_hash,created_at,expires_at,closed,frame_seq,frame,input_seq)
          VALUES ('view-1',?,'h',?,?,0,5,?,1)`,
        )
        .bind(
          owner,
          now,
          now + 60_000,
          await sealed("open-muse-browser-frame", 5, { f: 1 }),
        ),
      db
        .prepare(
          "INSERT INTO browser_inputs(view_id,owner_id,seq,encrypted,created_at) VALUES ('view-1',?,1,?,?)",
        )
        .bind(
          owner,
          await sealed("open-muse-browser-input", 1, { type: "back" }),
          now,
        ),
      db
        .prepare(
          `INSERT INTO account_sync_items(owner_id,workspace_key,namespace,item_id,revision,encrypted,deleted,mutation_id,seq,updated_at)
          VALUES (?,'wk','model','choice',6,?,0,'m',1,?)`,
        )
        .bind(
          owner,
          await sealed("open-muse-account-sync", 6, {
            workspace: "wk",
            namespace: "model",
            id: "choice",
            value: { model: "m", effort: "high" },
          }),
          now,
        ),
      db
        .prepare(
          "INSERT INTO lark_states(owner_id,revision,encrypted,updated_at) VALUES (?,7,?,?)",
        )
        .bind(owner, await sealed("open-muse-lark-state", 7, "AAAA"), now),
    );
    await db.batch(statements);
    expect(await pendingRewrap(base)).toBe(0);

    const rotating: Env = {
      ...base,
      CREDENTIAL_ENCRYPTION_KEYS_NEXT: ring("v2", { v2: k2 }),
    };
    expect(await pendingRewrap(rotating)).toBe(10);
    // One row per table per call when limited to one.
    expect(await rewrapRetiredKeys(rotating, 1)).toBe(SEALED_COLUMNS.length);
    expect(await pendingRewrap(rotating)).toBe(2);

    // The signed tick finishes the work and reports progress publicly.
    const tick = await handle(
      new Request("https://api.example.com/internal/scheduler/tick", {
        method: "POST",
        headers: triggerHeaders(secret),
      }),
      rotating,
    );
    expect(tick.status).toBe(200);
    expect(await pendingRewrap(rotating)).toBe(0);
    const health = (await (
      await handle(new Request("https://api.example.com/health"), rotating)
    ).json()) as { keyRotation: unknown };
    expect(health.keyRotation).toEqual({ pending: 0 });

    // Everything opens with only the new keyring after the swap.
    const swapped: Env = {
      ...base,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v2", { v2: k2 }),
    };
    for (const { table, column, revision, purpose } of SEALED_COLUMNS) {
      const rows = await db
        .prepare(
          `SELECT ${revision} AS revision,${column} AS sealed FROM ${table} WHERE owner_id=?`,
        )
        .bind(owner)
        .all<{ revision: number; sealed: string }>();
      expect(rows.results.length).toBeGreaterThan(0);
      for (const row of rows.results)
        await expect(
          unseal(swapped, purpose, owner, row.revision, row.sealed),
        ).resolves.toBeDefined();
    }
  });

  it("leaves rows it cannot open counted, without blocking the rest", async () => {
    const env: Env = {
      ...base,
      CREDENTIAL_ENCRYPTION_KEYS: ring("v3", { v3: k3 }),
    };
    // Rows sealed under v2 cannot be opened with v3 alone.
    expect(await rewrapRetiredKeys(env)).toBe(0);
    expect(await pendingRewrap(env)).toBe(10);
    expect(
      await pendingRewrap({ ...env, CREDENTIAL_ENCRYPTION_KEYS: "" }),
    ).toBe(undefined);
  });
});
