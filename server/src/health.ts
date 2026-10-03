import type { Env } from "./env";
import { externalScheduler } from "./trigger";
import { pendingRewrap } from "./rotation";

// A tick runs every five minutes; three missed ticks make the clock stale.
export const SCHEDULER_STALE_AFTER = 15 * 60_000;

type Heartbeat = {
  created_at: number;
  last_tick_at: number | null;
  last_failure_at: number | null;
  rewrap_pending: number | null;
};

function record(env: Env, columns: Record<string, unknown>, now: number) {
  const names = Object.keys(columns);
  return env.DB.prepare(
    `INSERT INTO scheduler_heartbeat(id,created_at,${names.join(",")})
    VALUES ('scheduler',?,${names.map(() => "?").join(",")})
    ON CONFLICT(id) DO UPDATE SET ${names.map((name) => `${name}=excluded.${name}`).join(",")}`,
  )
    .bind(now, ...Object.values(columns))
    .run();
}

// Runs one scheduler tick and records its outcome for the health check: the
// time of success, or the time and a fixed code of a failure (never the error
// itself, which may name upstream state). Recording is best effort and never
// changes the tick's own result.
export async function heartbeat(
  env: Env,
  tick: () => Promise<void>,
  clock = Date.now,
) {
  try {
    await tick();
  } catch (error) {
    await record(
      env,
      { last_failure_at: clock(), last_failure_code: "tick_failed" },
      clock(),
    ).catch(() => {});
    throw error;
  }
  const pending = await pendingRewrap(env).catch(() => undefined);
  await record(
    env,
    {
      last_tick_at: clock(),
      rewrap_pending: pending ?? null,
      rewrap_checked_at: clock(),
    },
    clock(),
  ).catch(() => {});
}

// The public health check: liveness plus the scheduler's last successful tick
// and how many sealed values still wait for a key rotation. Only times and a
// count, nothing about accounts or configuration values. A deployment driven
// by the external clock with background work enabled answers 503 while the
// clock is stale, so an uptime monitor can alert on it.
export async function health(env: Env, now = Date.now()) {
  let row: Heartbeat | null = null;
  try {
    row = await env.DB.prepare(
      "SELECT created_at,last_tick_at,last_failure_at,rewrap_pending FROM scheduler_heartbeat WHERE id='scheduler'",
    ).first<Heartbeat>();
  } catch {
    // Unreadable progress counts as stale below.
  }
  const since = row?.last_tick_at ?? row?.created_at;
  const stale = since == null || now - since > SCHEDULER_STALE_AFTER;
  const alert =
    stale && externalScheduler(env) && env.BACKGROUND_ENABLED === "true";
  return {
    status: alert ? 503 : 200,
    body: {
      ok: !alert,
      service: "open-muse-server",
      scheduler: {
        lastTickAt: row?.last_tick_at ?? null,
        lastFailureAt: row?.last_failure_at ?? null,
        stale,
      },
      keyRotation: { pending: row?.rewrap_pending ?? null },
    },
  };
}
