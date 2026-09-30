import { z } from "zod";
import { ApiError, ArkClient } from "../../shared/ark";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import {
  DEFAULT_MODEL,
  agentSpec,
  environmentSpec,
  memoryStoreName,
  resourceName,
} from "../../shared/workspace-spec";
import {
  accountWorkspaceSchema,
  agentChangesSchema,
  environmentChangesSchema,
  type AccountWorkspace,
} from "../../shared/account-workspace";
import { AccountCredentials } from "./account";
import { ConnectionStore, seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";

type Kind = "environment" | "memory_store" | "agent";
const kinds: Record<
  Kind,
  { collection: string; field: keyof AccountWorkspace; label: string }
> = {
  environment: {
    collection: "environments",
    field: "environmentId",
    label: "open_muse_workspace",
  },
  memory_store: {
    collection: "memory_stores",
    field: "memoryStoreId",
    label: "open_muse_identity",
  },
  agent: {
    collection: "agents",
    field: "agentId",
    label: "open_muse_workspace",
  },
};
const pendingSchema = z
  .object({
    kind: z.enum(["environment", "memory_store", "agent"]),
    nonce: z.string().uuid(),
    // An unconfirmed creation left a resource Open Muse will never adopt.
    review: z.boolean().optional(),
  })
  .strict();
type Row = {
  revision: number;
  encrypted: string | null;
  pending: string | null;
};
const purpose = "open-muse-account-workspace";
const base = "https://ark.cn-beijing.volces.com/api/v3";
const CREATE_WINDOW = 3_600_000,
  CREATE_LIMIT = 20,
  UPDATE_LIMIT = 60;
const validId = (value: unknown) => {
  if (typeof value !== "string" || !/^[\w-]{1,200}$/.test(value))
    throw new HttpError(502, "The upstream resource ID is invalid.");
  return value;
};

// The account's workspace: the Worker creates every resource with the
// account's own stored key and records it from its own creation response, so
// no label, discovery, or claim race can hand one account another's resource.
// The sealed record is the account's configuration on every device.
export class AccountWorkspaces {
  constructor(
    private env: Env,
    private owner: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async context(credentialRevision?: number) {
    const stored = await new AccountCredentials(this.env, this.owner).read();
    if (
      !stored.credential ||
      (credentialRevision !== undefined &&
        stored.revision !== credentialRevision)
    )
      throw new HttpError(
        409,
        "Your Ark API key changed. Refresh before preparing the workspace.",
      );
    const { apiKey, project } = stored.credential;
    return {
      workspaceKey: accountWorkspaceKey(apiKey, project, this.owner),
      ark: new ArkClient(
        { arkBaseUrl: base, arkKey: apiKey, project },
        this.fetcher,
      ),
    };
  }
  private row(workspaceKey: string) {
    return this.env.DB.prepare(
      "SELECT revision,encrypted,pending FROM account_workspaces WHERE owner_id=? AND workspace_key=?",
    )
      .bind(this.owner, workspaceKey)
      .first<Row>();
  }
  private async decode(workspaceKey: string, row: Row | null) {
    if (!row?.encrypted) return { model: DEFAULT_MODEL } as AccountWorkspace;
    let value: unknown;
    try {
      value = await unseal(
        this.env,
        purpose,
        this.owner,
        row.revision,
        row.encrypted,
      );
    } catch {
      value = undefined;
    }
    const sealed = value as { workspaceKey?: unknown; workspace?: unknown };
    const parsed = accountWorkspaceSchema.safeParse(sealed?.workspace);
    if (
      !parsed.success ||
      sealed.workspaceKey !== workspaceKey ||
      Object.keys(sealed).length !== 2
    )
      throw new HttpError(
        503,
        "Encrypted workspace storage is unavailable. Check the service keyring.",
      );
    return parsed.data;
  }
  async read() {
    const { workspaceKey } = await this.context();
    const row = await this.row(workspaceKey);
    const pending = row?.pending
      ? pendingSchema.parse(JSON.parse(row.pending))
      : undefined;
    return {
      revision: row?.revision ?? 0,
      workspace: row?.encrypted
        ? await this.decode(workspaceKey, row)
        : undefined,
      unconfirmed: Boolean(pending?.review),
    };
  }
  // Compare-and-swap on the record revision; the owner and workspace key are
  // authenticated with the ciphertext.
  private async write(
    workspaceKey: string,
    revision: number,
    workspace: AccountWorkspace,
    pending: z.infer<typeof pendingSchema> | null,
    now: number,
    claim?: { kind: Kind; id: string },
  ) {
    const encrypted = await seal(this.env, purpose, this.owner, revision + 1, {
      workspaceKey,
      workspace: accountWorkspaceSchema.parse(workspace),
    });
    const mutation = crypto.randomUUID();
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO account_workspaces(owner_id,workspace_key,revision,encrypted,pending,updated_at,mutation_id)
        SELECT ?,?,1,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM account_workspaces WHERE owner_id=? AND workspace_key=?)
        ON CONFLICT(owner_id,workspace_key) DO UPDATE SET revision=account_workspaces.revision+1,encrypted=excluded.encrypted,
        pending=excluded.pending,updated_at=excluded.updated_at,mutation_id=excluded.mutation_id
        WHERE account_workspaces.revision=?`,
      ).bind(
        this.owner,
        workspaceKey,
        encrypted,
        pending ? JSON.stringify(pending) : null,
        now,
        mutation,
        revision,
        this.owner,
        workspaceKey,
        revision,
      ),
      ...(claim
        ? [
            this.env.DB.prepare(
              `INSERT INTO account_resources(kind,resource_id,owner_id,claimed_at)
              SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM account_workspaces WHERE owner_id=? AND mutation_id=?)
              ON CONFLICT(kind,resource_id) DO NOTHING`,
            ).bind(claim.kind, claim.id, this.owner, now, this.owner, mutation),
          ]
        : []),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(
        409,
        "The workspace is being prepared on another device. Refresh and try again.",
      );
    return revision + 1;
  }
  private async quota(now: number, bucket = "provision", limit = CREATE_LIMIT) {
    const result = await this.env.DB.prepare(
      `INSERT INTO account_rate_limits(owner_id,bucket,window_start,count) VALUES (?,?,?,1)
      ON CONFLICT(owner_id,bucket) DO UPDATE SET
        count=CASE WHEN account_rate_limits.window_start<=? THEN 1 ELSE account_rate_limits.count+1 END,
        window_start=CASE WHEN account_rate_limits.window_start<=? THEN excluded.window_start ELSE account_rate_limits.window_start END
      WHERE account_rate_limits.window_start<=? OR account_rate_limits.count<?`,
    )
      .bind(
        this.owner,
        bucket,
        now,
        now - CREATE_WINDOW,
        now - CREATE_WINDOW,
        now - CREATE_WINDOW,
        limit,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        429,
        "Too many workspace changes for this account. Try again in an hour.",
      );
  }
  // Only ever lists; the result decides whether a new creation is safe.
  private async created(ark: ArkClient, kind: Kind, nonce: string) {
    const found: string[] = [];
    let page = "";
    for (let index = 0; index < 20; index++) {
      const result = await ark.request<{
        data?: { id: string; metadata?: Record<string, string> }[];
        next_page?: string;
      }>(
        `/${kinds[kind].collection}?limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`,
      );
      if (!Array.isArray(result.data))
        throw new HttpError(502, "Invalid upstream page.");
      for (const item of result.data)
        if (item.metadata?.open_muse_provision === nonce) found.push(item.id);
      if (!result.next_page) return found;
      page = result.next_page;
    }
    throw new HttpError(
      502,
      "Upstream resources could not be listed completely. Nothing was created.",
    );
  }
  async provision(
    credentialRevision: number,
    replaceUnconfirmed = false,
    now = Date.now(),
  ) {
    const { workspaceKey, ark } = await this.context(credentialRevision);
    for (const kind of ["environment", "memory_store", "agent"] as Kind[]) {
      const { collection, field, label } = kinds[kind];
      let row = await this.row(workspaceKey);
      let revision = row?.revision ?? 0;
      const workspace = await this.decode(workspaceKey, row);
      const id = workspace[field] as string | undefined;
      if (id) {
        try {
          const resource = await ark.request<{
            id: string;
            metadata?: Record<string, string>;
          }>(`/${collection}/${encodeURIComponent(id)}`);
          if (resource.id !== id || resource.metadata?.[label] !== workspaceKey)
            throw new HttpError(
              409,
              "A workspace resource was changed outside Open Muse. Review it in the Ark console.",
            );
          continue;
        } catch (error) {
          // A resource deleted at Ark is recreated; anything else stops here.
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          delete workspace[field];
          revision = await this.write(
            workspaceKey,
            revision,
            workspace,
            null,
            now,
          );
          row = await this.row(workspaceKey);
        }
      }
      const pending = row?.pending
        ? pendingSchema.parse(JSON.parse(row.pending))
        : undefined;
      if (pending) {
        if (!pending.review) {
          // The last creation was unconfirmed. Query instead of repeating it.
          const found = await this.created(ark, pending.kind, pending.nonce);
          if (found.length) {
            // Never adopted: its creation cannot be attributed to this
            // account with certainty. Leave it for the user to review.
            await this.write(
              workspaceKey,
              revision,
              workspace,
              { ...pending, review: true },
              now,
            );
            throw new HttpError(
              409,
              "An earlier setup step may have created a resource that Open Muse will not use. Continue setup to create a new one.",
            );
          }
        } else if (!replaceUnconfirmed)
          throw new HttpError(
            409,
            "An earlier setup step may have created a resource that Open Muse will not use. Continue setup to create a new one.",
          );
      }
      await this.quota(now);
      const nonce = crypto.randomUUID();
      revision = await this.write(
        workspaceKey,
        revision,
        workspace,
        { kind, nonce },
        now,
      );
      const metadata = { [label]: workspaceKey, open_muse_provision: nonce };
      const body =
        kind === "memory_store"
          ? { name: memoryStoreName, metadata }
          : {
              ...(kind === "agent"
                ? agentSpec(workspace.model)
                : environmentSpec()),
              name: `${resourceName(workspaceKey)}-${kind}`,
              metadata,
            };
      let created: string;
      try {
        created = validId(
          (
            await ark.request<{ id: string }>(`/${collection}`, {
              method: "POST",
              body: JSON.stringify(body),
            })
          ).id,
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          [400, 401, 403, 404, 413, 422, 429].includes(error.status)
        ) {
          await this.write(workspaceKey, revision, workspace, null, now);
          throw new HttpError(
            422,
            `Ark refused to create the workspace ${kind.replace("_", " ")} (HTTP ${error.status}).`,
          );
        }
        throw new HttpError(
          503,
          "The workspace creation result is unconfirmed. Continue setup to check it; nothing was repeated.",
        );
      }
      await this.write(
        workspaceKey,
        revision,
        { ...workspace, [field]: created },
        null,
        now,
        { kind, id: created },
      );
    }
    return this.read();
  }
  // Applies a user's change to the account's own agent or environment. The
  // target comes from the sealed record, never from the request, and the
  // resulting settings are sealed with it so other devices and background
  // work use the same configuration.
  async update(
    kind: "agent" | "environment",
    changes: unknown,
    revision: number,
    credentialRevision: number,
    now = Date.now(),
  ) {
    const parsed = (
      kind === "agent" ? agentChangesSchema : environmentChangesSchema
    ).safeParse(changes);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Only name, description, model, instructions, tools, MCP servers, skills, or environment settings can be changed.",
      );
    const { workspaceKey, ark } = await this.context(credentialRevision);
    const row = await this.row(workspaceKey);
    if ((row?.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "The workspace settings changed on another device. Refresh before saving.",
      );
    const workspace = await this.decode(workspaceKey, row);
    const { collection, field } = kinds[kind];
    const id = workspace[field] as string | undefined;
    if (!id)
      throw new HttpError(409, "Prepare the workspace before changing it.");
    await this.quota(now, "update", UPDATE_LIMIT);
    try {
      await ark.request(`/${collection}/${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500)
        throw new HttpError(
          422,
          `Ark refused the change (HTTP ${error.status}). Nothing was saved.`,
        );
      // Not repeated: reading the resource again shows whether it applied.
      throw new HttpError(
        503,
        "The change is unconfirmed. Refresh the workspace to check it; it was not repeated.",
      );
    }
    const current = await ark.request<Record<string, unknown>>(
      `/${collection}/${encodeURIComponent(id)}`,
    );
    const fields =
      kind === "agent"
        ? [
            "version",
            "name",
            "description",
            "model",
            "system",
            "tools",
            "mcp_servers",
            "skills",
          ]
        : ["name", "description", "config"];
    const settings = Object.fromEntries(
      fields.filter((key) => key in current).map((key) => [key, current[key]]),
    );
    if (JSON.stringify(settings).length > 100_000)
      throw new HttpError(413, "The workspace settings are too large to save.");
    const model = (settings.model as { id?: unknown } | undefined)?.id;
    await this.write(
      workspaceKey,
      revision,
      {
        ...workspace,
        [kind]: settings,
        ...(kind === "agent" && typeof model === "string" ? { model } : {}),
      },
      null,
      now,
    );
    // Background work pins the agent version it was allowed with. Rebinding
    // to the new version pauses the schedule until the user enables it again.
    let background: "unchanged" | "rebound" | "stale" = "unchanged";
    const connections = new ConnectionStore(this.env, this.owner);
    const binding = await connections.resolve().catch(() => undefined);
    if (
      kind === "agent" &&
      binding?.revision &&
      binding.env.ARK_AGENT_ID === id &&
      typeof settings.version === "number"
    )
      try {
        await connections.save(
          {
            apiKey: binding.env.ARK_API_KEY!,
            project: binding.env.ARK_PROJECT ?? "",
            agentId: id,
            agentVersion: settings.version,
            environmentId: binding.env.ARK_ENVIRONMENT_ID!,
            memoryStoreId: binding.env.ARK_MEMORY_STORE_ID!,
          },
          binding.revision,
          now,
          this.fetcher,
          { credentialRevision, workspaceKey },
        );
        background = "rebound";
      } catch {
        background = "stale";
      }
    return { ...(await this.read()), background };
  }
}
