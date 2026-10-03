import { HttpError, type Env } from "./env";

// Every table that keeps data for an account, children before the rows they
// reference. A new owner-keyed table must be listed here so deleting an
// account leaves nothing of it behind.
export const ACCOUNT_TABLES = [
  "webhook_deliveries",
  "webhooks",
  "browser_inputs",
  "browser_views",
  "feed_items",
  "runs",
  "schedules",
  "ark_connections",
  "upcoming_deliveries",
  "upcoming_messages",
  "upcoming_targets",
  "proactive_claims",
  "account_devices",
  "account_sync_items",
  "account_sync_counters",
  "account_resources",
  "account_workspaces",
  "account_rate_limits",
  "account_key_checks",
  "account_credentials",
] as const;

// Deletes everything the service keeps for the account, then the sign-in
// itself. Data goes first so a failure at the Auth provider can be retried
// with the same, still valid sign-in. Ark resources belong to the person's
// Ark account and are left alone.
export async function deleteAccount(env: Env, owner: string, userId: string) {
  if (!env.DELETE_AUTH_USER)
    throw new HttpError(
      503,
      "Deleting accounts is not available on this service.",
    );
  await env.DB.batch(
    ACCOUNT_TABLES.map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner),
    ),
  );
  await env.DELETE_AUTH_USER(userId);
  return { deleted: true as const };
}
