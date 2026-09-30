import { z } from "zod";
import {
  backgroundConfigurationSchema,
  type BackgroundConfiguration,
  type BackgroundConnectionStatus,
} from "../../shared/background-connection";
import { ArkRemote } from "./ark";
import { backgroundReady, HttpError, type Env } from "./env";

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
const aad = (owner: string, revision: number) =>
  new TextEncoder().encode(
    JSON.stringify(["open-muse-ark-connection", 1, owner, revision]),
  );
async function cryptoKey(value: string) {
  return crypto.subtle.importKey("raw", bytes(value), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptConfiguration(
  env: Env,
  owner: string,
  revision: number,
  config: BackgroundConfiguration,
) {
  const ring = keyring(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad(owner, revision),
      tagLength: 128,
    },
    await cryptoKey(ring.keys[ring.current]),
    new TextEncoder().encode(
      JSON.stringify(backgroundConfigurationSchema.parse(config)),
    ),
  );
  return JSON.stringify({
    version: 1,
    keyId: ring.current,
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(encrypted)),
  });
}
export async function decryptConfiguration(
  env: Env,
  owner: string,
  row: Row,
): Promise<BackgroundConfiguration> {
  try {
    const ring = keyring(env),
      envelope = envelopeSchema.parse(JSON.parse(row.encrypted!));
    if (!ring.keys[envelope.keyId] || bytes(envelope.iv).length !== 12)
      throw new Error();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(envelope.iv),
        additionalData: aad(owner, row.revision),
        tagLength: 128,
      },
      await cryptoKey(ring.keys[envelope.keyId]),
      bytes(envelope.ciphertext),
    );
    return backgroundConfigurationSchema.parse(
      JSON.parse(new TextDecoder().decode(decrypted)),
    );
  } catch {
    throw unavailable();
  }
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
    if (!row)
      return backgroundReady(this.env)
        ? { env: this.env, revision: null }
        : undefined;
    if (!row.encrypted) return;
    return {
      env: configurationEnv(
        this.env,
        await decryptConfiguration(this.env, this.owner, row),
      ),
      revision: row.revision,
    };
  }
  guardedFetch(
    revision: number | null,
    fetcher: typeof fetch = fetch,
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
    fetcher: typeof fetch = fetch,
  ) {
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
    const remote = new ArkRemote(configurationEnv(this.env, config), fetcher);
    try {
      await remote.verifyAccess();
    } catch {
      throw new HttpError(
        422,
        "The current Ark workspace could not be verified. Refresh the local workspace and retry.",
      );
    }
    const fingerprint = await remote.fingerprint();
    const encrypted = await encryptConfiguration(
      this.env,
      this.owner,
      revision + 1,
      config,
    );
    const mutation = crypto.randomUUID();
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO ark_connections(owner_id,revision,encrypted,updated_at,mutation_id)
      SELECT ?,1,?,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=?))
      AND NOT EXISTS(SELECT 1 FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed') AND (connection_hash IS NULL OR connection_hash<>?))
      ON CONFLICT(owner_id) DO UPDATE SET revision=ark_connections.revision+1,encrypted=excluded.encrypted,updated_at=excluded.updated_at,mutation_id=excluded.mutation_id
      WHERE ark_connections.revision=? AND NOT EXISTS(SELECT 1 FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed') AND (connection_hash IS NULL OR connection_hash<>?))`,
      ).bind(
        this.owner,
        encrypted,
        now,
        mutation,
        revision,
        this.owner,
        this.owner,
        fingerprint,
        revision,
        this.owner,
        fingerprint,
      ),
      this.env.DB.prepare(
        `UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1,updated_at=? WHERE owner_id=?
        AND EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=? AND mutation_id=?)`,
      ).bind(now, this.owner, this.owner, mutation),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(
        409,
        "The connection changed or a run is unresolved. Refresh and review before syncing.",
      );
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
      this.env.DB.prepare(
        `UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1,updated_at=? WHERE owner_id=?
        AND EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=? AND mutation_id=?)`,
      ).bind(now, this.owner, this.owner, mutation),
      this.env.DB.prepare(
        `UPDATE runs SET resume_phase=CASE WHEN phase='needs_attention' THEN resume_phase ELSE phase END,
        phase=CASE WHEN phase IN ('queued','creating','ready') OR
          (phase='needs_attention' AND resume_phase IN ('queued','creating','ready')) THEN 'failed' ELSE 'needs_attention' END,
        prompt='',
        lease_token=NULL,lease_until=NULL,error='Background credentials were removed. Existing MA work is not cancelled.',updated_at=?
        WHERE owner_id=? AND phase NOT IN ('complete','failed') AND EXISTS(SELECT 1 FROM ark_connections WHERE owner_id=? AND mutation_id=?)`,
      ).bind(now, this.owner, this.owner, mutation),
    ]);
    if (!result[0].meta.changes)
      throw new HttpError(
        409,
        "The connection changed. Refresh before removing it.",
      );
    return this.status();
  }
}
