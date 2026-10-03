import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { heartbeat, SCHEDULER_STALE_AFTER } from "../src/health";
import type { Env } from "../src/env";
import { triggerHeaders } from "../deploy/volcengine/scheduler/trigger.mjs";

const secret = "test-trigger-secret-".repeat(3);

describe("Scheduler heartbeat and health", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SCHEDULER_SOURCE: "external",
      SCHEDULER_TRIGGER_SECRET: secret,
      BACKGROUND_ENABLED: "true",
    };
  });
  afterAll(async () => fixture?.dispose());
  const health = async (target = env) => {
    const res = await handle(
      new Request("https://api.example.com/health"),
      target,
    );
    return {
      status: res.status,
      body: (await res.json()) as {
        ok: boolean;
        scheduler: {
          lastTickAt: number | null;
          lastFailureAt: number | null;
          stale: boolean;
        };
        keyRotation: { pending: number | null };
      },
    };
  };
  const tick = (target = env) =>
    handle(
      new Request("https://api.example.com/internal/scheduler/tick", {
        method: "POST",
        headers: triggerHeaders(secret),
      }),
      target,
    );
  const age = (column: string, ms: number) =>
    env.DB.prepare(
      `UPDATE scheduler_heartbeat SET ${column}=? WHERE id='scheduler'`,
    )
      .bind(Date.now() - ms)
      .run();

  it("is healthy right after deployment, before the first tick", async () => {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "open-muse-server",
      scheduler: { lastTickAt: null, lastFailureAt: null, stale: false },
      keyRotation: { pending: null },
    });
  });

  it("answers 503 once the external clock is stale with background work on", async () => {
    await age("created_at", SCHEDULER_STALE_AFTER + 60_000);
    const stale = await health();
    expect(stale.status).toBe(503);
    expect(stale.body).toMatchObject({
      ok: false,
      scheduler: { lastTickAt: null, stale: true },
    });
    // Without the external clock or background work, staleness is reported
    // but liveness stays ok.
    for (const target of [
      { ...env, BACKGROUND_ENABLED: undefined },
      { ...env, SCHEDULER_SOURCE: undefined },
    ]) {
      const result = await health(target);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        ok: true,
        scheduler: { stale: true },
      });
    }
  });

  it("records each successful tick and recovers", async () => {
    const before = Date.now();
    expect((await tick()).status).toBe(200);
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scheduler.stale).toBe(false);
    expect(body.scheduler.lastTickAt).toBeGreaterThanOrEqual(before);
    // No keyring here, so rotation progress is unknown.
    expect(body.keyRotation).toEqual({ pending: null });
    await age("last_tick_at", SCHEDULER_STALE_AFTER + 1);
    expect((await health()).status).toBe(503);
    expect((await tick()).status).toBe(200);
    expect((await health()).status).toBe(200);
  });

  it("records a failed tick with a fixed code and never its error", async () => {
    await expect(
      heartbeat(env, async () => {
        throw new Error("private upstream detail sk-secret");
      }),
    ).rejects.toThrow("private upstream detail");
    const row = await env.DB.prepare(
      "SELECT last_failure_at,last_failure_code FROM scheduler_heartbeat WHERE id='scheduler'",
    ).first<{ last_failure_at: number; last_failure_code: string }>();
    expect(row?.last_failure_code).toBe("tick_failed");
    const { body } = await health();
    expect(body.scheduler.lastFailureAt).toBe(row?.last_failure_at);
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("tick_failed");
  });

  it("treats unreadable progress as stale", async () => {
    const broken = {
      ...env,
      DB: {
        ...env.DB,
        prepare: () => {
          throw new Error("database down");
        },
      } as unknown as Env["DB"],
    };
    const { status, body } = await health(broken);
    expect(status).toBe(503);
    expect(body).toEqual({
      ok: false,
      service: "open-muse-server",
      scheduler: { lastTickAt: null, lastFailureAt: null, stale: true },
      keyRotation: { pending: null },
    });
  });
});
