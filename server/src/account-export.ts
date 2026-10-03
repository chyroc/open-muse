import { ACCOUNT_TABLES } from "./account-deletion";
import { AccountCredentials } from "./account";
import { decryptConfiguration, unseal } from "./connection";
import { HttpError, type Env } from "./env";

// A copy of everything the service keeps for one account, for that account
// only. Sealed values are opened for the tables handled below. The Ark API key
// itself never leaves (only its last four characters), nor do token hashes,
// leases, connection fingerprints, or pending prompts. A table without a
// handler is still exported from the deletion list: its columns that look
// secret are left out and sealed values are marked "sealed".
export const EXPORT_FORMAT = 1;
const ROW_LIMIT = 10_000;
type Row = Record<string, unknown>;
type Context = {
  env: Env;
  owner: string;
  select: (table: string, sql: string, ...binds: unknown[]) => Promise<Row[]>;
};
// A value that the current keyring could not open.
const UNAVAILABLE = "unavailable";
async function opened<T>(open: () => Promise<T>) {
  try {
    return await open();
  } catch {
    return UNAVAILABLE;
  }
}
const parsed = (value: unknown) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return value;
  }
};

const handlers: Record<string, (context: Context) => Promise<Row[]>> = {
  async account_credentials({ env, owner, select }) {
    const rows = await select(
      "account_credentials",
      "SELECT revision,encrypted,updated_at,issuer,last_seen_at FROM account_credentials WHERE owner_id=?",
      owner,
    );
    return Promise.all(
      rows.map(async ({ encrypted, ...row }) => ({
        ...row,
        configured: Boolean(encrypted),
        credential: encrypted
          ? await opened(async () => {
              const { apiKey, project } = await new AccountCredentials(
                env,
                owner,
              ).decrypt({
                revision: row.revision as number,
                encrypted: encrypted as string,
                updated_at: row.updated_at as number,
              });
              return { project, api_key_last4: apiKey.slice(-4) };
            })
          : null,
      })),
    );
  },
  async ark_connections({ env, owner, select }) {
    const rows = await select(
      "ark_connections",
      "SELECT revision,encrypted,updated_at FROM ark_connections WHERE owner_id=?",
      owner,
    );
    return Promise.all(
      rows.map(async ({ encrypted, ...row }) => ({
        ...row,
        configured: Boolean(encrypted),
        workspace: encrypted
          ? await opened(async () => {
              const config = await decryptConfiguration(env, owner, {
                revision: row.revision as number,
                encrypted: encrypted as string,
                updated_at: row.updated_at as number,
              });
              return {
                project: config.project,
                agentId: config.agentId,
                agentVersion: config.agentVersion,
                environmentId: config.environmentId,
                memoryStoreId: config.memoryStoreId,
              };
            })
          : null,
      })),
    );
  },
  async account_workspaces({ env, owner, select }) {
    const rows = await select(
      "account_workspaces",
      "SELECT workspace_key,revision,encrypted,pending,updated_at FROM account_workspaces WHERE owner_id=? ORDER BY updated_at",
      owner,
    );
    return Promise.all(
      rows.map(async ({ encrypted, pending, ...row }) => ({
        ...row,
        pending: pending ? parsed(pending) : null,
        workspace: encrypted
          ? await opened(async () => {
              const value = (await unseal(
                env,
                "open-muse-account-workspace",
                owner,
                row.revision as number,
                encrypted as string,
              )) as { workspaceKey?: unknown; workspace?: unknown };
              if (value?.workspaceKey !== row.workspace_key) throw new Error();
              return value.workspace;
            })
          : null,
      })),
    );
  },
  async account_devices({ env, owner, select }) {
    const rows = await select(
      "account_devices",
      "SELECT device_id,platform,app_version,revision,encrypted,created_at,last_seen_at FROM account_devices WHERE owner_id=? ORDER BY last_seen_at DESC,device_id",
      owner,
    );
    return Promise.all(
      rows.map(async ({ encrypted, revision, ...row }) => ({
        ...row,
        name: await opened(async () => {
          const value = (await unseal(
            env,
            "open-muse-account-device",
            owner,
            revision as number,
            encrypted as string,
          )) as { id?: unknown; name?: unknown };
          if (value?.id !== row.device_id || typeof value.name !== "string")
            throw new Error();
          return value.name;
        }),
      })),
    );
  },
  // Synced settings and lists, opened per item. Tombstones have no value.
  async account_sync_items({ env, owner, select }) {
    const rows = await select(
      "account_sync_items",
      "SELECT workspace_key,namespace,item_id,revision,encrypted,deleted,seq,updated_at FROM account_sync_items WHERE owner_id=? ORDER BY seq",
      owner,
    );
    return Promise.all(
      rows.map(async ({ encrypted, ...row }) => ({
        ...row,
        value: encrypted
          ? await opened(async () => {
              const value = (await unseal(
                env,
                "open-muse-account-sync",
                owner,
                row.revision as number,
                encrypted as string,
              )) as Record<string, unknown>;
              if (
                value?.workspace !== row.workspace_key ||
                value.namespace !== row.namespace ||
                value.id !== row.item_id
              )
                throw new Error();
              return value.value;
            })
          : null,
      })),
    );
  },
  schedules: ({ owner, select }) =>
    select(
      "schedules",
      "SELECT enabled,timezone,local_time,next_run_at,revision,updated_at,consent_at FROM schedules WHERE owner_id=?",
      owner,
    ),
  // Prompts are kept only until submission and are left out with leases and
  // connection fingerprints.
  runs: ({ owner, select }) =>
    select(
      "runs",
      `SELECT id,request_key,scheduled_for,phase,resume_phase,session_id,event_id,error,
      next_check_at,deadline_at,created_at,updated_at FROM runs WHERE owner_id=? ORDER BY created_at,id`,
      owner,
    ),
  async feed_items({ owner, select }) {
    const rows = await select(
      "feed_items",
      "SELECT sequence,id,run_id,session_id,event_id,position,content,created_at FROM feed_items WHERE owner_id=? ORDER BY sequence",
      owner,
    );
    return rows.map((row) => ({ ...row, content: parsed(row.content) }));
  },
  upcoming_targets: ({ owner, select }) =>
    select(
      "upcoming_targets",
      "SELECT session_id,language,enabled,since,revision,state,next_check_at,updated_at FROM upcoming_targets WHERE owner_id=?",
      owner,
    ),
  upcoming_messages: ({ owner, select }) =>
    select(
      "upcoming_messages",
      "SELECT event_id,session_id,phase,created_at,updated_at FROM upcoming_messages WHERE owner_id=? ORDER BY created_at DESC,event_id",
      owner,
    ),
  upcoming_deliveries: ({ owner, select }) =>
    select(
      "upcoming_deliveries",
      "SELECT item_id,occurrence_at,event_id FROM upcoming_deliveries WHERE owner_id=? ORDER BY occurrence_at DESC,item_id",
      owner,
    ),
  account_resources: ({ owner, select }) =>
    select(
      "account_resources",
      "SELECT kind,resource_id,claimed_at FROM account_resources WHERE owner_id=? ORDER BY claimed_at,kind,resource_id",
      owner,
    ),
  account_rate_limits: ({ owner, select }) =>
    select(
      "account_rate_limits",
      "SELECT bucket,window_start,count FROM account_rate_limits WHERE owner_id=? ORDER BY bucket",
      owner,
    ),
  // Which device or the service sent each check-in, reminder, or goal
  // follow-up. The claim key is a date or an occurrence, not a credential.
  proactive_claims: ({ owner, select }) =>
    select(
      "proactive_claims",
      "SELECT kind,claim_key,session_id,claimant,created_at,expires_at FROM proactive_claims WHERE owner_id=? ORDER BY created_at",
      owner,
    ),
  account_key_checks: ({ owner, select }) =>
    select(
      "account_key_checks",
      "SELECT window_start,count FROM account_key_checks WHERE owner_id=?",
      owner,
    ),
  // The cloud browser relay keeps a short-lived frame and pending input that
  // expire with the view; they are listed without their content.
  async browser_views({ owner, select }) {
    const rows = await select(
      "browser_views",
      "SELECT view_id,created_at,expires_at,closed,frame_seq,frame_at,frame FROM browser_views WHERE owner_id=? ORDER BY created_at",
      owner,
    );
    return rows.map(({ frame, ...row }) => ({
      ...row,
      frame: frame ? "omitted" : null,
    }));
  },
  async browser_inputs({ owner, select }) {
    const rows = await select(
      "browser_inputs",
      "SELECT view_id,seq,created_at FROM browser_inputs WHERE owner_id=? ORDER BY view_id,seq",
      owner,
    );
    return rows.map((row) => ({ ...row, event: "omitted" }));
  },
};

// Columns of an unhandled table that may hold a credential or a lookup value
// for one: left out entirely.
const SECRET_COLUMN =
  /(^|_)(token|secret|password|hash|digest|nonce|signature|lease|key)(_|$)/i;
const SEALED_VALUE = /^\{"version":1,"keyId":/;
function generic(row: Row): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === "owner_id" || SECRET_COLUMN.test(column)) continue;
    out[column] =
      value != null &&
      (column === "encrypted" ||
        (typeof value === "string" && SEALED_VALUE.test(value)))
        ? "sealed"
        : value;
  }
  return out;
}

export async function exportAccount(env: Env, owner: string, now: number) {
  const truncated: string[] = [];
  const select = async (table: string, sql: string, ...binds: unknown[]) => {
    const rows = (
      await env.DB.prepare(`${sql} LIMIT ${ROW_LIMIT + 1}`)
        .bind(...binds)
        .all<Row>()
    ).results;
    if (rows.length > ROW_LIMIT) {
      truncated.push(table);
      rows.length = ROW_LIMIT;
    }
    return rows;
  };
  const tables: Record<string, Row[]> = {};
  try {
    for (const table of ACCOUNT_TABLES as readonly string[]) {
      const handler = handlers[table];
      tables[table] = handler
        ? await handler({ env, owner, select })
        : (
            await select(
              table,
              `SELECT * FROM ${table} WHERE owner_id=?`,
              owner,
            )
          ).map(generic);
    }
  } catch {
    throw new HttpError(
      503,
      "Your data could not be exported right now. Try again later.",
    );
  }
  return {
    format: EXPORT_FORMAT,
    exportedAt: now,
    owner,
    tables,
    ...(truncated.length ? { truncated } : {}),
  };
}
