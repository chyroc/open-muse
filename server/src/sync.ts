import {
  SYNC_LIMITS,
  syncPushInput,
  syncValue,
  type SyncItem,
  type SyncMutation,
  type SyncNamespace,
  type SyncResult,
} from "../../shared/account-sync";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import { AccountCredentials } from "./account";
import { seal, unseal } from "./connection";
import { HttpError, maEndpoint, type Env } from "./env";

// Personal settings and lists kept in step across one account's devices: a
// small document store per account and workspace key. Every value is sealed
// with the account; the sealed value also names its workspace key, namespace,
// and item ID, so a row moved to another item, workspace, or account cannot be
// opened as that item. Deletions leave tombstones so a device that has not
// synced yet cannot bring an item back.
const purpose = "open-muse-account-sync";
type Row = {
  namespace: SyncNamespace;
  item_id: string;
  revision: number;
  encrypted: string | null;
  deleted: number;
  mutation_id: string;
  seq: number;
  updated_at: number;
};
const columns =
  "namespace,item_id,revision,encrypted,deleted,mutation_id,seq,updated_at";

export function pullInput(params: URLSearchParams) {
  const workspace = params.get("workspace") ?? "";
  const after = Number(params.get("after") ?? "0");
  if (
    !/^[0-9a-f]{64}$/.test(workspace) ||
    !Number.isSafeInteger(after) ||
    after < 0
  )
    throw new HttpError(400, "Name the workspace and a valid cursor.");
  return { workspace, after };
}

export function pushInput(input: Record<string, unknown>) {
  const parsed = syncPushInput.safeParse(input);
  if (!parsed.success)
    throw new HttpError(400, "Send a valid batch of sync changes.");
  return parsed.data;
}

export class AccountSync {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  // Only the workspace of the account's current key: the key includes the
  // verified owner, so another account's workspace is never reachable here.
  private async check(workspace: string) {
    const stored = await new AccountCredentials(this.env, this.owner).read();
    if (!stored.credential)
      throw new HttpError(
        409,
        "Add an Ark API key before syncing.",
        "workspace_changed",
      );
    const { apiKey, project } = stored.credential;
    if (
      accountWorkspaceKey(
        apiKey,
        project,
        this.owner,
        maEndpoint(this.env).provider,
      ) !== workspace
    )
      throw new HttpError(
        409,
        "Your Ark API key changed. Refresh before syncing.",
        "workspace_changed",
      );
  }

  private async view(workspace: string, row: Row): Promise<SyncItem> {
    let value: unknown = null;
    if (!row.deleted) {
      const sealed = (await unseal(
        this.env,
        purpose,
        this.owner,
        row.revision,
        row.encrypted ?? "",
      )) as Record<string, unknown>;
      if (
        sealed?.workspace !== workspace ||
        sealed.namespace !== row.namespace ||
        sealed.id !== row.item_id ||
        !("value" in sealed)
      )
        throw new HttpError(
          503,
          "Encrypted sync storage is unavailable. Check the service keyring.",
        );
      value = sealed.value;
    }
    return {
      namespace: row.namespace,
      id: row.item_id,
      revision: row.revision,
      value,
      mutation_id: row.mutation_id,
      seq: row.seq,
      updated_at: row.updated_at,
    };
  }

  async pull(workspace: string, after: number) {
    await this.check(workspace);
    const rows = await this.env.DB.prepare(
      `SELECT ${columns} FROM account_sync_items
      WHERE owner_id=? AND workspace_key=? AND seq>? ORDER BY seq LIMIT ?`,
    )
      .bind(this.owner, workspace, after, SYNC_LIMITS.page + 1)
      .all<Row>();
    const page = rows.results.slice(0, SYNC_LIMITS.page);
    const items: SyncItem[] = [];
    for (const row of page) items.push(await this.view(workspace, row));
    return {
      items,
      cursor: page.length ? page[page.length - 1].seq : after,
      hasMore: rows.results.length > SYNC_LIMITS.page,
    };
  }

  private row(workspace: string, namespace: string, id: string) {
    return this.env.DB.prepare(
      `SELECT ${columns} FROM account_sync_items
      WHERE owner_id=? AND workspace_key=? AND namespace=? AND item_id=?`,
    )
      .bind(this.owner, workspace, namespace, id)
      .first<Row>();
  }

  // Each item is written only if it is still at the client's base revision;
  // otherwise the server copy is returned and nothing is overwritten.
  // Repeating a mutation ID that already wrote the item reports it as
  // applied without writing again.
  async push(
    input: { workspace: string; mutations: SyncMutation[] },
    now = Date.now(),
  ) {
    const { workspace } = input;
    await this.check(workspace);
    const results: (SyncResult | undefined)[] = [];
    const pending: {
      index: number;
      mutation: SyncMutation;
      revision: number;
    }[] = [];
    const statements = [];
    for (const [index, mutation] of input.mutations.entries()) {
      const { namespace, id, base_revision, mutation_id } = mutation;
      const checked = syncValue(namespace, id, mutation.value);
      if (!checked.ok) {
        results[index] = {
          status: "rejected",
          namespace,
          id,
          reason: "invalid",
        };
        continue;
      }
      const current = await this.row(workspace, namespace, id);
      if (current?.mutation_id === mutation_id) {
        results[index] = {
          status: "applied",
          namespace,
          id,
          revision: current.revision,
          seq: current.seq,
        };
        continue;
      }
      if ((current?.revision ?? 0) !== base_revision) {
        results[index] = {
          status: "conflict",
          namespace,
          id,
          item: current ? await this.view(workspace, current) : null,
        };
        continue;
      }
      const revision = base_revision + 1;
      const encrypted =
        checked.value === null
          ? null
          : await seal(this.env, purpose, this.owner, revision, {
              workspace,
              namespace,
              id,
              value: checked.value,
            });
      const deleted = checked.value === null ? 1 : 0;
      // The counter row is locked until the batch commits, so sequence
      // numbers become visible in order and an incremental pull never skips
      // a change committed later with a lower number.
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO account_sync_counters(owner_id,seq) VALUES(?,1)
          ON CONFLICT(owner_id) DO UPDATE SET seq=account_sync_counters.seq+1`,
        ).bind(this.owner),
        base_revision === 0
          ? this.env.DB.prepare(
              `INSERT INTO account_sync_items(owner_id,workspace_key,namespace,item_id,revision,encrypted,deleted,mutation_id,seq,updated_at)
              SELECT ?,?,?,?,1,?,?,?,(SELECT seq FROM account_sync_counters WHERE owner_id=?),?
              WHERE (SELECT count(*) FROM account_sync_items WHERE owner_id=?)<?
              ON CONFLICT DO NOTHING`,
            ).bind(
              this.owner,
              workspace,
              namespace,
              id,
              encrypted,
              deleted,
              mutation_id,
              this.owner,
              now,
              this.owner,
              SYNC_LIMITS.items,
            )
          : this.env.DB.prepare(
              `UPDATE account_sync_items SET revision=?,encrypted=?,deleted=?,mutation_id=?,
              seq=(SELECT seq FROM account_sync_counters WHERE owner_id=?),updated_at=?
              WHERE owner_id=? AND workspace_key=? AND namespace=? AND item_id=? AND revision=?`,
            ).bind(
              revision,
              encrypted,
              deleted,
              mutation_id,
              this.owner,
              now,
              this.owner,
              workspace,
              namespace,
              id,
              base_revision,
            ),
      );
      pending.push({ index, mutation, revision });
    }
    const written = statements.length
      ? await this.env.DB.batch(statements)
      : [];
    for (const [n, { index, mutation }] of pending.entries()) {
      const { namespace, id } = mutation;
      const current = await this.row(workspace, namespace, id);
      if (written[n * 2 + 1].meta.changes && current)
        results[index] = {
          status: "applied",
          namespace,
          id,
          revision: current.revision,
          seq: current.seq,
        };
      else if (current)
        results[index] =
          current.mutation_id === mutation.mutation_id
            ? {
                status: "applied",
                namespace,
                id,
                revision: current.revision,
                seq: current.seq,
              }
            : {
                status: "conflict",
                namespace,
                id,
                item: await this.view(workspace, current),
              };
      // Nothing was written and no row exists: the account is at its limit.
      else
        results[index] = { status: "rejected", namespace, id, reason: "limit" };
    }
    return { results: results as SyncResult[] };
  }
}
