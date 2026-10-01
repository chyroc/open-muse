import { edgeFetch } from "./fetch";
import { z } from "zod";
import {
  backgroundConfigurationSchema,
  type BackgroundConfiguration,
  type BackgroundConnectionStatus,
} from "../../shared/background-connection";
import { ArkRemote } from "./ark";
import { ApiError } from "../../shared/ark";
import { authorizedOwners } from "./auth";
import { backgroundReady, HttpError, type Env } from "./env";
import { isSupabaseOwner } from "../../shared/supabase-auth";

type Row = { revision: number; encrypted: string | null; updated_at: number };
const envelopeSchema = z
  .object({
    version: z.literal(1),
    keyId: z.string(),
    iv: z.string(),
    ciphertext: z.string(),
  })
  .strict();
const unavailable = () =>
  new HttpError(
    503,
    "Encrypted credential storage is unavailable. Check the service keyring.",
  );
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
function keyring(env: Env) {
  try {
    const ring = z
      .object({
        current: z.string().regex(/^[\w-]{1,40}$/),
        keys: z.record(z.string().regex(/^[\w-]{1,40}$/), z.string()),
      })
      .strict()
      .parse(JSON.parse(env.CREDENTIAL_ENCRYPTION_KEYS ?? ""));
    if (!ring.keys[ring.current] || Object.keys(ring.keys).length > 10)
      throw new Error();
    for (const key of Object.values(ring.keys))
      if (bytes(key).length !== 32) throw new Error();
    return ring;
  } catch {
    throw unavailable();
  }
}
export function credentialStorageReady(env: Env) {
  try {
    keyring(env);
    return true;
  } catch {
    return false;
  }
}
// The purpose, owner, and revision are authenticated with every ciphertext, so
// a row copied to another user, table, or revision cannot be decrypted.
export type SealPurpose =
  | "open-muse-ark-connection"
  | "open-muse-account-ark"
  | "open-muse-account-workspace"
  | "open-muse-account-device";
const aad = (purpose: SealPurpose, owner: string, revision: number) =>
  new TextEncoder().encode(JSON.stringify([purpose, 1, owner, revision]));
async function cryptoKey(value: string) {
  return crypto.subtle.importKey("raw", bytes(value), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(
  env: Env,
  purpose: SealPurpose,
  owner: string,
  revision: number,
  value: unknown,
) {
  const ring = keyring(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad(purpose, owner, revision),
      tagLength: 128,
    },
    await cryptoKey(ring.keys[ring.current]),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    version: 1,
    keyId: ring.current,
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(encrypted)),
  });
}
export async function unseal(
  env: Env,
  purpose: SealPurpose,
  owner: string,
  revision: number,
  encrypted: string,
): Promise<unknown> {
  try {
    const ring = keyring(env),
      envelope = envelopeSchema.parse(JSON.parse(encrypted));
    if (!ring.keys[envelope.keyId] || bytes(envelope.iv).length !== 12)
      throw new Error();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(envelope.iv),
        additionalData: aad(purpose, owner, revision),
        tagLength: 128,
      },
      await cryptoKey(ring.keys[envelope.keyId]),
      bytes(envelope.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw unavailable();
  }
}
// Retired keys stay readable until every row has been sealed again.
export function currentKeyId(env: Env) {
  try {
    return keyring(env).current;
  } catch {
    return undefined;
  }
}
export function encryptConfiguration(
  env: Env,
  owner: string,
  revision: number,
  config: BackgroundConfiguration,
) {
  return seal(
    env,
    "open-muse-ark-connection",
    owner,
    revision,
    backgroundConfigurationSchema.parse(config),
  );
}
export async function decryptConfiguration(
  env: Env,
  owner: string,
  row: Row,
): Promise<BackgroundConfiguration> {
  const value = await unseal(
    env,
    "open-muse-ark-connection",
    owner,
    row.revision,
    row.encrypted ?? "",
  );
  const config = backgroundConfigurationSchema.safeParse(value);
  if (!config.success) throw unavailable();
  return config.data;
}
export function configurationEnv(
  env: Env,
  config: BackgroundConfiguration,
): Env {
  return {
    ...env,
    ARK_API_KEY: config.apiKey,
    ARK_PROJECT: config.project,
    ARK_AGENT_ID: config.agentId,
    ARK_AGENT_VERSION: String(config.agentVersion),
    ARK_ENVIRONMENT_ID: config.environmentId,
    ARK_MEMORY_STORE_ID: config.memoryStoreId,
    ARK_SESSION_OVERRIDES: "true",
  };
}
export class ConnectionStore {
  constructor(
    private env: Env,
    private owner = env.OWNER_ID,
  ) {}
  row() {
    return this.env.DB.prepare(
      "SELECT revision,encrypted,updated_at FROM ark_connections WHERE owner_id=?",
    )
      .bind(this.owner)
      .first<Row>();
  }
  async status(): Promise<BackgroundConnectionStatus> {
    const row = await this.row();
    return {
      configured: Boolean(row?.encrypted),
      revision: row?.revision ?? 0,
      updatedAt: row?.updated_at ?? null,
    };
  }
  async resolve() {
    const row = await this.row();
    // Retain existing private deployments. A revocation tombstone disables this
    // fallback, so old service-level credentials can never resurrect access.
    // End-user accounts never inherit the service-level Ark configuration.
    if (!row)
      return this.owner === this.env.OWNER_ID &&
        !isSupabaseOwner(this.owner) &&
        authorizedOwners(this.env).length === 1 &&
        authorizedOwners(this.env)[0] === this.owner &&
        backgroundReady(this.env)
        ? { env: this.env, revision: null }
        : undefined;
    if (!row.encrypted) return;
    const config = await decryptConfiguration(this.env, this.owner, row);
    return {
      env: configurationEnv({ ...this.env, OWNER_ID: this.owner }, config),
      revision: row.revision,
    };
  }
  guardedFetch(
    revision: number | null,
    fetcher: typeof fetch = edgeFetch,
  ): typeof fetch {
    return async (input, init) => {
      const row = await this.row();
      if (revision !== null && (!row?.encrypted || row.revision !== revision))
        throw new HttpError(
          409,
          "Background authorization changed. No further MA request was sent.",
        );
      if (revision === null && row)
        throw new HttpError(
          409,
          "Background authorization changed. No further MA request was sent.",
        );
      return fetcher(input, init);
    };
  }
  async save(
    config: BackgroundConfiguration,
    revision: number,
    now = Date.now(),
    fetcher: typeof fetch = edgeFetch,
    // Account workspaces bind to one stored credential revision, so a
    // concurrent key rotation makes this upload fail instead of reviving the
    // old key. Their resources must carry the account's ownership label and
    // may be bound by only one account.
    account: { credentialRevision: number; workspaceKey: string } | null = null,
  ) {
    const credentialRevision = account?.credentialRevision ?? null;
    const current = await this.row();
    if ((current?.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "The uploaded connection changed. Refresh before syncing.",
      );
    if (
      current?.encrypted &&
      JSON.stringify(
        await decryptConfiguration(this.env, this.owner, current),
      ) === JSON.stringify(config)
    )
      return this.status();
    // Only read-only validation is performed here. Uploading must never create
    // an agent, session, memory store, or generation as a side effect.
    if (
      account &&
      (
        await this.env.DB.prepare(
          `SELECT count(*) AS n FROM account_resources WHERE owner_id=? AND (
          (kind='agent' AND resource_id=?) OR (kind='environment' AND resource_id=?) OR (kind='memory_store' AND resource_id=?))`,
        )
          .bind(
            this.owner,
            config.agentId,
            config.environmentId,
            config.memoryStoreId,
          )
          .first<{ n: number }>()
      )?.n !== 3
    )
      // Checked before any Ark request, so nothing is read on another
      // account's behalf.
      throw new HttpError(
        403,
        "This workspace does not belong to the signed-in account.",
      );
    const remote = new ArkRemote(
      configurationEnv({ ...this.env, OWNER_ID: this.owner }, config),
      fetcher,
    );
    try {
      await remote.verifyAccess();
      if (account) await remote.verifyOwnership(account.workspaceKey);
    } catch (error) {
      throw new HttpError(
        error instanceof HttpError && error.status === 403 ? 403 : 422,
        error instanceof ApiError
          ? `Ark workspace verification failed (HTTP ${error.status}). Check the key's permissions and Worker-to-Ark access.`
          : error instanceof HttpError
            ? error.message
            : "The current Ark workspace could not be verified. Refresh the local workspace and retry.",
      );
    }
    // Account bindings may use only resources the service created for this
    // account (see workspace.ts). Labels and client input cannot add any.
    const owned = `(SELECT count(*) FROM account_resources WHERE owner_id=? AND (
      (kind='agent' AND resource_id=?) OR (kind='environment' AND resource_id=?) OR (kind='memory_store' AND resource_id=?)))=3`;
    const ownedBinds = [
      this.owner,
      config.agentId,
      config.environmentId,
      config.memoryStoreId,
    ];
    const fingerprint = await remote.fingerprint();
    const encrypted = await encryptConfiguration(
      this.env,
      this.owner,
      revision + 1,
      config,
    );
    const mutation = crypto.randomUUID();
    const credential = `(? IS NULL OR EXISTS(SELECT 1 FROM account_credentials WHERE owner_id=? AND revision=? AND encrypted IS NOT NULL))`;
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id)
      SELECT ?,1,?,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=?))
      AND NOT EXISTS(SELECT 1 FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed') AND (connection_hash IS NULL OR connection_hash<>?))
      AND ${credential} AND (?=0 OR ${owned})
      ON CONFLICT(owner_id) DO UPDATE SET revision=ark_connections.revision+1,encrypted=excluded.encrypted,updated_at=excluded.updated_at,mutation_id=excluded.mutation_id
      WHERE ark_connections.revision=? AND NOT EXISTS(SELECT 1 FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed') AND (connection_hash IS NULL OR connection_hash<>?))
      AND ${credential} AND (?=0 OR ${owned})`,
      ).bind(
        this.owner,
        encrypted,
        now,
        mutation,
        revision,
        this.owner,
        this.owner,
        fingerprint,
        credentialRevision,
        this.owner,
        credentialRevision,
        +Boolean(account),
        ...ownedBinds,
        revision,
        this.owner,
        fingerprint,
        credentialRevision,
        this.owner,
        credentialRevision,
        +Boolean(account),
        ...ownedBinds,
      ),
      this.env.DB.prepare(
        `UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1,updated_at=? WHERE owner_id=?
        AND EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=? AND mutation_id=?)`,
      ).bind(now, this.owner, this.owner, mutation),
    ]);
    if (!results[0].meta.changes) {
      if (
        account &&
        !(await this.env.DB.prepare(`SELECT 1 AS hit WHERE ${owned}`)
          .bind(...ownedBinds)
          .first())
      )
        throw new HttpError(
          403,
          "This workspace does not belong to the signed-in account.",
        );
      throw new HttpError(
        409,
        "The connection changed or a run is unresolved. Refresh and review before syncing.",
      );
    }
    return this.status();
  }
  async remove(revision: number, now = Date.now()) {
    const mutation = crypto.randomUUID();
    const result = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id)
        SELECT ?,1,NULL,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=?)
        ON CONFLICT(owner_id) DO UPDATE SET revision=ark_connections.revision+1,encrypted=NULL,updated_at=excluded.updated_at,mutation_id=excluded.mutation_id
        WHERE ark_connections.revision=?`,
      ).bind(this.owner, now, mutation, revision, this.owner, revision),
      ...revokeBackground(
        this.env.DB,
        this.owner,
        now,
        "ark_connections",
        mutation,
      ),
    ]);
    if (!result[0].meta.changes)
      throw new HttpError(
        409,
        "The connection changed. Refresh before removing it.",
      );
    return this.status();
  }
}

// Runs only after the guarded mutation committed in the same batch. Disables
// schedules and stops unfinished work without cancelling accepted MA writes.
export function revokeBackground(
  db: D1Database,
  owner: string,
  now: number,
  guard: "ark_connections" | "account_credentials" | "account_workspaces",
  mutation: string,
) {
  const committed = `EXISTS(SELECT 1 FROM ${guard} WHERE owner_id=? AND mutation_id=?)`;
  return [
    ...(guard !== "ark_connections"
      ? [
          db
            .prepare(
              `UPDATE ark_connections SET revision=revision+1,encrypted=NULL,updated_at=?,mutation_id=?
              WHERE owner_id=? AND encrypted IS NOT NULL AND ${committed}`,
            )
            .bind(now, mutation, owner, owner, mutation),
        ]
      : []),
    db
      .prepare(
        `UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1,updated_at=? WHERE owner_id=?
        AND ${committed}`,
      )
      .bind(now, owner, owner, mutation),
    db
      .prepare(
        `UPDATE runs SET resume_phase=CASE WHEN phase='needs_attention' THEN resume_phase ELSE phase END,
        phase=CASE WHEN phase IN ('queued','creating','ready') OR
          (phase='needs_attention' AND resume_phase IN ('queued','creating','ready')) THEN 'failed' ELSE 'needs_attention' END,
        prompt='',
        lease_token=NULL,lease_until=NULL,error='Background credentials were removed. Existing MA work is not cancelled.',updated_at=?
        WHERE owner_id=? AND phase NOT IN ('complete','failed') AND ${committed}`,
      )
      .bind(now, owner, owner, mutation),
  ];
}
