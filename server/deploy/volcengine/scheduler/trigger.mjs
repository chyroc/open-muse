// Signs one scheduler trigger for the Open Muse service. Shared by the veFaaS
// timer function and tests; depends only on Node.js built-ins.
import { createHmac, randomBytes } from "node:crypto";

export const TRIGGER_PATH = "/internal/scheduler/tick";

export function triggerHeaders(secret, now = Date.now()) {
  const timestamp = String(now);
  const nonce = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`open-muse-scheduler-v1\n${timestamp}\n${nonce}`)
    .digest("hex");
  return {
    "X-Muse-Timestamp": timestamp,
    "X-Muse-Nonce": nonce,
    "X-Muse-Signature": signature,
  };
}

// The service's base URL: an HTTPS origin, optionally with a path such as
// a Supabase function's `/functions/v1/open-muse`.
export function apiOrigin(value) {
  const url = new URL(value ?? "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("MUSE_API_ORIGIN must be an HTTPS URL.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

// Sends one trigger. Never retried here: a lost response is harmless because
// the next timer tick resumes persisted work, and duplicates are rejected.
export async function trigger(env, fetcher = fetch, now = Date.now()) {
  const origin = apiOrigin(env.MUSE_API_ORIGIN);
  const secret = env.SCHEDULER_TRIGGER_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret))
    throw new Error("SCHEDULER_TRIGGER_SECRET is not configured.");
  const response = await fetcher(`${origin}${TRIGGER_PATH}`, {
    method: "POST",
    headers: triggerHeaders(secret, now),
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  });
  return response.status;
}
