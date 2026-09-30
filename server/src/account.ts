import { ApiError, ArkClient } from "../../shared/ark";
import {
  accountCredentialSchema,
  type AccountCredential,
  type AccountCredentialStatus,
} from "../../shared/account-credential";
import { currentKeyId, revokeBackground, seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";
import { supabaseOrigin } from "../../shared/supabase-auth";
import { accountWorkspaceKey } from "../../shared/workspace-key";

type Row = { revision: number; encrypted: string | null; updated_at: number };
const base = "https://ark.cn-beijing.volces.com/api/v3";
const purpose = "open-muse-account-ark";
const KEY_CHECK_WINDOW = 3_600_000,
  KEY_CHECK_LIMIT = 10;
// Background work for an account stops when it has not made a verified request
// for this long, bounding work for deleted or suspended provider accounts.
export const ACCOUNT_ACTIVITY_WINDOW = 30 * 86_400_000;
export type ResourceKind = "agent" | "environment" | "memory_store";
const resourceKinds: Record<ResourceKind, [string, string]> = {
  agent: ["agents", "open_muse_workspace"],
  environment: ["environments", "open_muse_workspace"],
  memory_store: ["memory_stores", "open_muse_identity"],
};

// One encrypted Ark credential per verified account owner. Every device of the
// account reads the same record; other accounts cannot address it, even when
// they upload the same key.
export class AccountCredentials {
  constructor(
    private env: Env,
    private owner: string,
  ) {}
  // Called after the provider verified this account's session. The owner ID is
  // derived from the configured issuer, so the issuer is recorded here too.
  seen(now: number) {
    const issuer = supabaseOrigin(this.env.SUPABASE_AUTH_URL);
    return this.env.DB.prepare(
      `UPDATE account_credentials SET last_seen_at=?,issuer=?
      WHERE owner_id=? AND (COALESCE(last_seen_at,0)<? OR issuer IS NOT ?)`,
    )
      .bind(now, issuer, this.owner, now - 3_600_000, issuer)
      .run();
  }
  row() {
    return this.env.DB.prepare(
      "SELECT revision,encrypted,updated_at FROM account_credentials WHERE owner_id=?",
    )
      .bind(this.owner)
      .first<Row>();
  }
  async status(row?: Row | null): Promise<AccountCredentialStatus> {
    row = row === undefined ? await this.row() : row;
    return {
      configured: Boolean(row?.encrypted),
      revision: row?.revision ?? 0,
      updatedAt: row?.updated_at ?? null,
    };
  }
  async read(): Promise<
    AccountCredentialStatus & { credential?: AccountCredential }
  > {
    const row = await this.row();
    const status = await this.status(row);
    if (!row?.encrypted) return status;
    return { ...status, credential: await this.decrypt(row) };
  }
  async decrypt(row: Row) {
    const credential = accountCredentialSchema.safeParse(
      await unseal(
        this.env,
        purpose,
        this.owner,
        row.revision,
        row.encrypted ?? "",
      ),
    );
    if (!credential.success)
      throw new HttpError(
        503,
        "Encrypted credential storage is unavailable. Check the service keyring.",
      );
    return credential.data;
  }
  async save(
    credential: AccountCredential,
    revision: number,
    now = Date.now(),
    fetcher: typeof fetch = fetch,
  ) {
    credential = accountCredentialSchema.parse(credential);
    const current = await this.row();
    if ((current?.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "Your Ark API key changed on another device. Refresh before saving.",
      );
    if (
      current?.encrypted &&
      JSON.stringify(await this.decrypt(current)) === JSON.stringify(credential)
    )
      return this.status(current);
    // Each check reveals whether a key is valid, so accounts get a small
    // hourly budget. Provider signup limits bound how many accounts exist.
    const quota = await this.env.DB.prepare(
      `INSERT INTO account_key_checks(owner_id,window_start,count) VALUES (?,?,1)
      ON CONFLICT(owner_id) DO UPDATE SET
        count=CASE WHEN account_key_checks.window_start<=? THEN 1 ELSE account_key_checks.count+1 END,
        window_start=CASE WHEN account_key_checks.window_start<=? THEN excluded.window_start ELSE account_key_checks.window_start END
      WHERE account_key_checks.window_start<=? OR account_key_checks.count<?`,
    )
      .bind(
        this.owner,
        now,
        now - KEY_CHECK_WINDOW,
        now - KEY_CHECK_WINDOW,
        now - KEY_CHECK_WINDOW,
        KEY_CHECK_LIMIT,
      )
      .run();
    if (!quota.meta.changes)
      throw new HttpError(
        429,
        "Too many API key checks for this account. Try again in an hour.",
      );
    // Read-only check. Saving a key never creates cloud resources.
    try {
      await new ArkClient(
        {
          arkBaseUrl: base,
          arkKey: credential.apiKey,
          project: credential.project,
        },
        fetcher,
      ).request("/agents?limit=1");
    } catch (error) {
      throw new HttpError(
        422,
        error instanceof ApiError
          ? `Ark rejected this API key (HTTP ${error.status}). Check the key and project.`
          : "The API key could not be verified with Ark. Nothing was saved.",
      );
    }
    return this.commit(
      await seal(this.env, purpose, this.owner, revision + 1, credential),
      revision,
      now,
    );
  }
  remove(revision: number, now = Date.now()) {
    return this.commit(null, revision, now);
  }
  // The client records each resource right after it provisions or adopts it,
  // so an ownership record normally exists before anyone else could relabel
  // the resource. Only a resource labelled for this account is recorded.
  async claim(
    kind: ResourceKind,
    id: string,
    now = Date.now(),
    fetcher: typeof fetch = fetch,
  ) {
    const stored = await this.read();
    if (!stored.credential)
      throw new HttpError(
        409,
        "Save an Ark API key to your account before preparing a workspace.",
      );
    const [collection, label] = resourceKinds[kind];
    let resource: { id?: string; metadata?: Record<string, string> };
    try {
      resource = await new ArkClient(
        {
          arkBaseUrl: base,
          arkKey: stored.credential.apiKey,
          project: stored.credential.project,
        },
        fetcher,
      ).request(`/${collection}/${encodeURIComponent(id)}`);
    } catch (error) {
      throw new HttpError(
        422,
        error instanceof ApiError
          ? `Ark could not confirm this resource (HTTP ${error.status}).`
          : "Ark could not confirm this resource. Nothing was recorded.",
      );
    }
    if (
      resource.id !== id ||
      resource.metadata?.[label] !==
        accountWorkspaceKey(
          stored.credential.apiKey,
          stored.credential.project,
          this.owner,
        )
    )
      throw new HttpError(
        403,
        "This workspace does not belong to the signed-in account.",
      );
    await this.env.DB.prepare(
      `INSERT INTO account_resources(kind,resource_id,owner_id,claimed_at) VALUES (?,?,?,?)
      ON CONFLICT(kind,resource_id) DO NOTHING`,
    )
      .bind(kind, id, this.owner, now)
      .run();
    const owner = await this.env.DB.prepare(
      "SELECT owner_id FROM account_resources WHERE kind=? AND resource_id=?",
    )
      .bind(kind, id)
      .first<{ owner_id: string }>();
    if (owner?.owner_id !== this.owner)
      throw new HttpError(
        403,
        "This workspace does not belong to the signed-in account.",
      );
    return { claimed: true };
  }
  // Replacing or removing the key also revokes the background binding sealed
  // with the previous key, so no scheduled run can keep using it.
  private async commit(
    encrypted: string | null,
    revision: number,
    now: number,
  ) {
    const mutation = crypto.randomUUID();
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO account_credentials(owner_id,revision,encrypted,updated_at,mutation_id,issuer,last_seen_at)
        SELECT ?,1,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM account_credentials WHERE owner_id=?)
        ON CONFLICT(owner_id) DO UPDATE SET revision=account_credentials.revision+1,encrypted=excluded.encrypted,updated_at=excluded.updated_at,
        mutation_id=excluded.mutation_id,issuer=excluded.issuer,last_seen_at=excluded.last_seen_at
        WHERE account_credentials.revision=?`,
      ).bind(
        this.owner,
        encrypted,
        now,
        mutation,
        supabaseOrigin(this.env.SUPABASE_AUTH_URL),
        now,
        revision,
        this.owner,
        revision,
      ),
      ...revokeBackground(
        this.env.DB,
        this.owner,
        now,
        "account_credentials",
        mutation,
      ),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(
        409,
        "Your Ark API key changed on another device. Refresh before saving.",
      );
    return this.status();
  }
}

// Seal rows written under a retired key with the current key. The revision and
// ciphertext guard prevents overwriting a concurrent user change.
export async function rewrapRetiredKeys(env: Env, limit = 20) {
  const current = currentKeyId(env);
  if (!current) return;
  for (const [table, rowPurpose] of [
    ["account_credentials", purpose],
    ["ark_connections", "open-muse-ark-connection"],
  ] as const) {
    const rows = await env.DB.prepare(
      `SELECT owner_id,revision,encrypted FROM ${table}
      WHERE encrypted IS NOT NULL AND json_extract(encrypted,'$.keyId')<>? LIMIT ?`,
    )
      .bind(current, limit)
      .all<{ owner_id: string; revision: number; encrypted: string }>();
    for (const row of rows.results) {
      try {
        const value = await unseal(
          env,
          rowPurpose,
          row.owner_id,
          row.revision,
          row.encrypted,
        );
        await env.DB.prepare(
          `UPDATE ${table} SET encrypted=? WHERE owner_id=? AND revision=? AND encrypted=?`,
        )
          .bind(
            await seal(env, rowPurpose, row.owner_id, row.revision, value),
            row.owner_id,
            row.revision,
            row.encrypted,
          )
          .run();
      } catch {
        /* Leave the row readable under its original key. */
      }
    }
  }
}
