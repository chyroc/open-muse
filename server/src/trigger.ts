import { HttpError, type Env } from "./env";

// An external clock, such as a Volcengine veFaaS timer trigger, can drive
// background work instead of Workers Cron. Only one clock is active per
// deployment: SCHEDULER_SOURCE=external disables the cron handler, and the
// endpoint is not served otherwise.
export const TRIGGER_PATH = "/internal/scheduler/tick";
export const TRIGGER_SKEW = 5 * 60_000;

export const externalScheduler = (env: Env) =>
  env.SCHEDULER_SOURCE === "external";

// The signed message binds a millisecond timestamp and a single-use nonce.
export const triggerMessage = (timestamp: string, nonce: string) =>
  `open-muse-scheduler-v1\n${timestamp}\n${nonce}`;

async function triggerKey(env: Env) {
  const secret = env.SCHEDULER_TRIGGER_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret))
    throw new HttpError(503, "The scheduler trigger is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

const hexBytes = (hex: string) =>
  new Uint8Array(hex.match(/../g)!.map((byte) => parseInt(byte, 16)));

export async function verifyTrigger(
  request: Request,
  env: Env,
  now = Date.now(),
) {
  if (!externalScheduler(env))
    throw new HttpError(404, "Endpoint not found.");
  const key = await triggerKey(env);
  const timestamp = request.headers.get("X-Muse-Timestamp") ?? "";
  const nonce = request.headers.get("X-Muse-Nonce") ?? "";
  const signature = request.headers.get("X-Muse-Signature") ?? "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    !/^[A-Za-z0-9_-]{22,64}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now - Number(timestamp)) > TRIGGER_SKEW ||
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      hexBytes(signature),
      new TextEncoder().encode(triggerMessage(timestamp, nonce)),
    ))
  )
    throw new HttpError(401, "The scheduler trigger is not authorized.");
  // A captured request cannot be replayed inside the accepted window.
  await env.DB.prepare(`DELETE FROM scheduler_triggers WHERE received_at<?`)
    .bind(now - 2 * TRIGGER_SKEW)
    .run();
  const inserted = await env.DB.prepare(
    `INSERT INTO scheduler_triggers(nonce,received_at) VALUES(?,?) ON CONFLICT DO NOTHING`,
  )
    .bind(nonce, now)
    .run();
  if (!inserted.meta.changes)
    throw new HttpError(409, "This scheduler trigger was already used.");
}
