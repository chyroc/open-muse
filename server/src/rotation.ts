import { currentKeyId, seal, unseal, type SealPurpose } from "./connection";
import type { Env } from "./env";

// Every column that holds a value sealed with the keyring, with the column
// that the ciphertext's authenticated revision comes from. A new sealed column
// must be listed here so a key rotation reaches it.
export const SEALED_COLUMNS: readonly {
  table: string;
  column: string;
  revision: string;
  purpose: SealPurpose;
}[] = [
  {
    table: "account_credentials",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-account-ark",
  },
  {
    table: "ark_connections",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-ark-connection",
  },
  {
    table: "account_workspaces",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-account-workspace",
  },
  {
    table: "account_devices",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-account-device",
  },
  {
    table: "browser_views",
    column: "frame",
    revision: "frame_seq",
    purpose: "open-muse-browser-frame",
  },
  {
    table: "browser_inputs",
    column: "encrypted",
    revision: "seq",
    purpose: "open-muse-browser-input",
  },
  // Sealed with the owner and item revision; the value itself names its
  // workspace key, namespace, and item ID. Tombstones have no value.
  {
    table: "account_sync_items",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-account-sync",
  },
  // The saved Lark sign-in; empty after lark-cli signs out.
  {
    table: "lark_states",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-lark-state",
  },
  // The Lark app and user tokens the service set up for the account.
  {
    table: "lark_connections",
    column: "encrypted",
    revision: "revision",
    purpose: "open-muse-lark-connection",
  },
];

// Sealed values are JSON envelopes naming the key that sealed them. Key IDs
// are letters, digits, "_" and "-", so only "_" needs escaping in LIKE.
const sealedUnder = (keyId: string) =>
  `%"keyId":"${keyId.replace(/_/g, "!_")}"%`;
const notCurrent = (column: string) =>
  `${column} IS NOT NULL AND ${column} NOT LIKE ? ESCAPE '!'`;

// Seals up to `limit` rows per column written under any other key with the
// current key. The revision and ciphertext guard prevents overwriting a
// concurrent change. Rows are picked at random, so a row that cannot be
// opened never blocks the others. Returns how many rows were resealed.
export async function rewrapRetiredKeys(env: Env, limit = 50) {
  const current = currentKeyId(env);
  if (!current) return 0;
  let resealed = 0;
  for (const { table, column, revision, purpose } of SEALED_COLUMNS) {
    // One unreadable table does not stop the others; it stays pending.
    const rows = await env.DB.prepare(
      `SELECT owner_id,${revision} AS revision,${column} AS sealed FROM ${table}
      WHERE ${notCurrent(column)} ORDER BY random() LIMIT ?`,
    )
      .bind(sealedUnder(current), limit)
      .all<{ owner_id: string; revision: number; sealed: string }>()
      .catch(() => ({ results: [] }));
    for (const row of rows.results) {
      try {
        const value = await unseal(
          env,
          purpose,
          row.owner_id,
          row.revision,
          row.sealed,
        );
        const result = await env.DB.prepare(
          `UPDATE ${table} SET ${column}=? WHERE owner_id=? AND ${revision}=? AND ${column}=?`,
        )
          .bind(
            await seal(env, purpose, row.owner_id, row.revision, value),
            row.owner_id,
            row.revision,
            row.sealed,
          )
          .run();
        resealed += result.meta.changes;
      } catch {
        /* Leave the row readable under its original key. */
      }
    }
  }
  return resealed;
}

// How many sealed values are not yet under the current key: 0 once a
// rotation has finished. Undefined when the keyring is unavailable.
export async function pendingRewrap(env: Env) {
  const current = currentKeyId(env);
  if (!current) return undefined;
  let pending = 0;
  for (const { table, column } of SEALED_COLUMNS) {
    const row = await env.DB.prepare(
      `SELECT count(*) AS n FROM ${table} WHERE ${notCurrent(column)}`,
    )
      .bind(sealedUnder(current))
      .first<{ n: number }>();
    pending += Number(row?.n ?? 0);
  }
  return pending;
}
