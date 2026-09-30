import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { database } from "./database";

// Replays 0006 on rows written before ownership records existed.
describe("Revoking unverified account bindings", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    fixture = await database();
  });
  afterAll(async () => fixture.dispose());
  it("revokes only account bindings without ownership records", async () => {
    const db = fixture.db;
    const unverified = "muse_user_" + "a".repeat(64),
      verified = "muse_user_" + "b".repeat(64),
      device = "private-owner";
    for (const owner of [unverified, verified, device]) {
      await db
        .prepare(
          "INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id) VALUES (?,1,'sealed',1,'seed')",
        )
        .bind(owner)
        .run();
      await db
        .prepare(
          "INSERT INTO schedules(owner_id,enabled,timezone,local_time,next_run_at,revision,updated_at) VALUES (?,1,'UTC','09:00',5,1,1)",
        )
        .bind(owner)
        .run();
      await db
        .prepare(
          `INSERT INTO runs(id,owner_id,request_key,scheduled_for,phase,marker,event_id,next_check_at,created_at,updated_at)
          VALUES (?,?,?,1,'queued',?,?,1,1,1)`,
        )
        .bind(
          crypto.randomUUID(),
          owner,
          `manual:${owner}`,
          `marker-${owner}`,
          `event-${owner}`,
        )
        .run();
    }
    await db
      .prepare(
        "INSERT INTO account_resources(kind,resource_id,owner_id,claimed_at) VALUES ('agent','agent-b',?,1)",
      )
      .bind(verified)
      .run();
    const sql = readFileSync(
      new URL(
        "../migrations/0006_revoke_unverified_account_bindings.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
    const state = async (owner: string) => ({
      sealed: (
        await db
          .prepare("SELECT encrypted FROM ark_connections WHERE owner_id=?")
          .bind(owner)
          .first<{ encrypted: string | null }>()
      )?.encrypted,
      scheduled: (
        await db
          .prepare("SELECT enabled FROM schedules WHERE owner_id=?")
          .bind(owner)
          .first<{ enabled: number }>()
      )?.enabled,
      phase: (
        await db
          .prepare("SELECT phase FROM runs WHERE owner_id=?")
          .bind(owner)
          .first<{ phase: string }>()
      )?.phase,
    });
    expect(await state(unverified)).toEqual({
      sealed: null,
      scheduled: 0,
      phase: "failed",
    });
    for (const owner of [verified, device])
      expect(await state(owner)).toEqual({
        sealed: "sealed",
        scheduled: 1,
        phase: "queued",
      });
    // 0007 drops every label-based record and revokes every account binding
    // made with one; private device owners are untouched.
    const statements = readFileSync(
      new URL("../migrations/0007_account_workspaces.sql", import.meta.url),
      "utf8",
    )
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && !/^(--[^\n]*\n)*\s*CREATE TABLE/.test(s));
    await db.batch(statements.map((s) => db.prepare(s)));
    expect(await state(verified)).toEqual({
      sealed: null,
      scheduled: 0,
      phase: "failed",
    });
    expect(await state(device)).toEqual({
      sealed: "sealed",
      scheduled: 1,
      phase: "queued",
    });
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM account_resources")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
});
