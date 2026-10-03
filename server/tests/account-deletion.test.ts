import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { ACCOUNT_TABLES } from "../src/account-deletion";
import type { Env } from "../src/env";
import { accountEnv, seedAccount, session, withAuth } from "./accounts";

const config = (n: number) => ({
  apiKey: `test-ark-key-for-deletion-${n}-000000`,
  project: "",
  agentId: `agent-${n}`,
  agentVersion: 1,
  environmentId: `env-${n}`,
  memoryStoreId: `memory-${n}`,
});

describe("Deleting an Open Muse account", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const deleteUser = vi.fn(async (_id: string) => {});
  const auth = withAuth();
  const [alice, bob] = [session(), session()];
  const call = (token: string, path: string, method = "GET", body?: unknown) =>
    handle(
      new Request(`https://background.example${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      auth,
    );
  const rows = async (owner: string) => {
    const counts: Record<string, number> = {};
    for (const table of ACCOUNT_TABLES) {
      const row = await env.DB.prepare(
        `SELECT count(*) AS n FROM ${table} WHERE owner_id=?`,
      )
        .bind(owner)
        .first<{ n: number }>();
      counts[table] = Number(row?.n ?? 0);
    }
    return counts;
  };
  const total = async (owner: string) =>
    Object.values(await rows(owner)).reduce((a, b) => a + b, 0);
  beforeAll(async () => {
    fixture = await database();
    env = accountEnv(fixture.db, {
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("k".repeat(32)) },
      }),
      DELETE_AUTH_USER: deleteUser,
    });
    for (const [user, n] of [
      [alice, 1],
      [bob, 2],
    ] as const) {
      await seedAccount(env, user.owner, config(n));
      const device = crypto.randomUUID();
      const registered = await call(
        user.token,
        `/v1/account/devices/${device}`,
        "PUT",
        { name: "iPhone", platform: "ios", app_version: "0.2.0" },
      );
      expect(registered.status).toBe(200);
    }
  });
  afterAll(async () => fixture?.dispose());

  it("lists every table that keeps account data", () => {
    const tables = new Set<string>();
    for (const dir of ["migrations", "migrations-postgres"]) {
      const path = join(import.meta.dirname, "..", dir);
      for (const file of readdirSync(path).filter((f) => f.endsWith(".sql")))
        for (const [, name, columns] of readFileSync(
          join(path, file),
          "utf8",
        ).matchAll(
          /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g,
        ))
          if (/\bowner_id\b/.test(columns)) tables.add(name);
    }
    expect(tables.size).toBeGreaterThan(0);
    expect([...tables].sort()).toEqual([...ACCOUNT_TABLES].sort());
  });

  it("requires explicit confirmation", async () => {
    for (const body of [
      undefined,
      {},
      { confirm: false },
      { confirm: true, x: 1 },
    ])
      expect(
        (await call(alice.token, "/v1/account", "DELETE", body)).status,
      ).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(await total(alice.owner)).toBeGreaterThan(0);
  });

  it("deletes nothing where the sign-in cannot be removed", async () => {
    const without = { ...env, DELETE_AUTH_USER: undefined };
    const res = await handle(
      new Request("https://background.example/v1/account", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${alice.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: true }),
      }),
      without,
      auth,
    );
    expect(res.status).toBe(503);
    expect(await total(alice.owner)).toBeGreaterThan(0);
  });

  it("removes only this account's data and then its sign-in", async () => {
    const before = await total(bob.owner);
    const res = await call(alice.token, "/v1/account", "DELETE", {
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(alice.id);
    expect(await total(alice.owner)).toBe(0);
    expect(await total(bob.owner)).toBe(before);
  });

  it("keeps the sign-in when removing it fails, so deleting can be retried", async () => {
    deleteUser.mockRejectedValueOnce(new Error("auth unavailable"));
    const res = await call(bob.token, "/v1/account", "DELETE", {
      confirm: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await total(bob.owner)).toBe(0);
    const retried = await call(bob.token, "/v1/account", "DELETE", {
      confirm: true,
    });
    expect(retried.status).toBe(200);
    expect(deleteUser).toHaveBeenLastCalledWith(bob.id);
  });
});
