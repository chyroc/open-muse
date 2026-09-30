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
  accountSkills,
  accountWorkspaceSchema,
  agentChangesSchema,
  environmentChangesSchema,
  type AccountWorkspace,
} from "../../shared/account-workspace";
import { digest } from "../../shared/crypto";
import { canonicalJson } from "../../shared/session-refresh";
import { AccountCredentials } from "./account";
import { ConnectionStore, revokeBackground, seal, unseal } from "./connection";
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
const creationPending = z
  .object({
    kind: z.enum(["environment", "memory_store", "agent"]),
    nonce: z.string().uuid(),
    // An unconfirmed creation left a resource Open Muse will never adopt.
    review: z.boolean().optional(),
  })
  .strict();
// A settings change holds the record while it is sent. Only the changed keys
// and a digest of their values are kept here, never the values themselves.
const updatePending = z
  .object({
    op: z.literal("update"),
    kind: z.enum(["agent", "environment"]),
    nonce: z.string().uuid(),
    base: z.number().int().positive().optional(),
    keys: z.array(z.string()),
    hash: z.string(),
    state: z.enum(["sending", "unconfirmed", "review"]),
    startedAt: z.number().int(),
  })
  .strict();
const pendingSchema = z.union([updatePending, creationPending]);
type Pending = z.infer<typeof pendingSchema>;
const settingsFields = {
  agent: [
    "version",
    "name",
    "description",
    "model",
    "system",
    "tools",
    "mcp_servers",
    "skills",
  ],
  environment: ["name", "description", "config"],
};
// Fields restored when a deleted agent or environment is created again.
const restoredFields = {
  agent: ["description", "model", "system", "tools", "mcp_servers", "skills"],
  environment: ["description", "config"],
};
const pick = (value: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
const fingerprint = (value: Record<string, unknown>, keys: string[]) =>
  digest(
    canonicalJson(
      Object.fromEntries(keys.map((key) => [key, value[key] ?? null])),
    ),
  );
// Settings that reference uploaded skills, other agents, or TOS buckets are
// never sealed or applied for an account.
const usable = (
  kind: "agent" | "environment",
  settings: Record<string, unknown>,
) =>
  kind === "agent"
    ? accountSkills(settings.skills) && !settings.multiagent
    : !(
        settings.config &&
        typeof settings.config === "object" &&
        "tos" in settings.config
      );
// Statuses with which Ark definitely did not apply a write. Timeouts, server
// errors, and lost responses leave the result unconfirmed.
const REJECTED = [400, 401, 403, 404, 409, 413, 422, 429];
const unconfirmed = (message: string) =>
  new HttpError(503, message, "unconfirmed");
type Row = {
  revision: number;
  encrypted: string | null;
  pending: string | null;
};
const purpose = "open-muse-account-workspace";
const base = "https://ark.cn-beijing.volces.com/api/v3";
const CREATE_WINDOW = 3_600_000,
  CREATE_LIMIT = 20,
  UPDATE_LIMIT = 60,
  SENDING_WINDOW = 120_000;
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
  private pending(row: Row | null): Pending | undefined {
    return row?.pending
      ? pendingSchema.parse(JSON.parse(row.pending))
      : undefined;
  }
  async read(): Promise<{
    revision: number;
    workspace?: AccountWorkspace;
    unconfirmed: boolean;
    settings?: "unconfirmed" | "review" | "drift";
  }> {
    const { workspaceKey } = await this.context();
    const row = await this.row(workspaceKey);
    const pending = this.pending(row);
    return {
      revision: row?.revision ?? 0,
      workspace: row?.encrypted
        ? await this.decode(workspaceKey, row)
        : undefined,
      unconfirmed: Boolean(pending && !("op" in pending) && pending.review),
      ...(pending && "op" in pending
        ? {
            settings:
              pending.state === "sending"
                ? ("unconfirmed" as const)
                : pending.state,
          }
        : row?.encrypted &&
            Object.keys((await this.decode(workspaceKey, row)).drift ?? {})
              .length
          ? { settings: "drift" as const }
          : {}),
    };
  }
  // Compare-and-swap on the record revision; the owner and workspace key are
  // authenticated with the ciphertext.
  private async write(
    workspaceKey: string,
    revision: number,
    workspace: AccountWorkspace,
    pending: Pending | null,
    now: number,
    claim?: { kind: Kind; id: string },
    // A replaced resource invalidates any background binding to the old one.
    revoke = false,
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
      ...(revoke
        ? revokeBackground(
            this.env.DB,
            this.owner,
            now,
            "account_workspaces",
            mutation,
          )
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
    // Explicit user choice to recreate a deleted agent or environment with
    // default settings when its saved settings cannot be used by an account.
    resetSettings = false,
    now = Date.now(),
  ) {
    const { workspaceKey, ark } = await this.context(credentialRevision);
    const rebuilt: Partial<
      Record<"agent" | "environment", "restored" | "recreated_with_defaults">
    > = {};
    const first = this.pending(await this.row(workspaceKey));
    if (first && "op" in first)
      throw new HttpError(
        409,
        "A workspace settings change is unconfirmed. Check it before preparing the workspace.",
        "settings_pending",
      );
    for (const kind of ["environment", "memory_store", "agent"] as Kind[]) {
      const { collection, field, label } = kinds[kind];
      const row = await this.row(workspaceKey);
      let revision = row?.revision ?? 0;
      const workspace = await this.decode(workspaceKey, row);
      const id = workspace[field] as string | undefined;
      let replaced = false;
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
          // Only a definite 404 means the resource is gone; it is created
          // again from the account's saved settings. Anything else stops.
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          replaced = true;
        }
      }
      const pending = this.pending(row);
      if (pending && !("op" in pending)) {
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
      // Saved settings are restored as they are. Settings an account may not
      // use are kept and block recreation until the user decides.
      let body: Record<string, unknown> =
        kind === "memory_store"
          ? { name: memoryStoreName }
          : kind === "agent"
            ? agentSpec(workspace.model)
            : environmentSpec();
      const next = { ...workspace };
      delete next[field];
      // A recreated resource starts from the saved settings, so any drift
      // for it ends; the result reports that the saved settings were used.
      if (kind !== "memory_store" && next.drift?.[kind] !== undefined) {
        const drift = { ...next.drift };
        delete drift[kind];
        next.drift = Object.keys(drift).length ? drift : undefined;
      }
      if (kind !== "memory_store" && workspace[kind]) {
        const saved = pick(workspace[kind]!, restoredFields[kind]);
        if (usable(kind, saved)) {
          body = { ...body, ...saved };
          rebuilt[kind] = "restored";
        } else if (!resetSettings)
          throw new HttpError(
            409,
            `The saved ${kind} settings reference resources an account cannot use. They are kept unchanged; choose to recreate it with default settings to continue.`,
            "rebuild_review",
            kind === "agent"
              ? ["skills", "multiagent"].filter((key) => key in saved)
              : ["config.tos"],
          );
        else {
          next.previous = { ...next.previous, [kind]: workspace[kind] };
          delete next[kind];
          rebuilt[kind] = "recreated_with_defaults";
        }
      }
      await this.quota(now);
      const nonce = crypto.randomUUID();
      revision = await this.write(
        workspaceKey,
        revision,
        next,
        { kind, nonce },
        now,
        undefined,
        replaced,
      );
      body = {
        ...body,
        ...(kind === "memory_store"
          ? {}
          : { name: `${resourceName(workspaceKey)}-${kind}` }),
        metadata: { [label]: workspaceKey, open_muse_provision: nonce },
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
          REJECTED.filter(
            (status) => status !== 409 && status !== 429,
          ).includes(error.status)
        ) {
          await this.write(workspaceKey, revision, workspace, null, now);
          throw new HttpError(
            422,
            `Ark refused to create the workspace ${kind.replace("_", " ")} (HTTP ${error.status}).`,
          );
        }
        throw unconfirmed(
          "The workspace creation result is unconfirmed. Continue setup to check it; nothing was repeated.",
        );
      }
      await this.write(
        workspaceKey,
        revision,
        { ...next, [field]: created },
        null,
        now,
        { kind, id: created },
      );
    }
    return {
      ...(await this.read()),
      ...(Object.keys(rebuilt).length ? { rebuilt } : {}),
    };
  }
  // Applies a user's change to the account's own agent or environment. The
  // target comes from the sealed record, never from the request. The record is
  // held before the change is sent, so only one change can be in flight, and
  // the result is sealed only when it is certain.
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
        "Only name, description, model, instructions, tools, MCP servers, built-in or hub skills, or environment settings without TOS buckets can be changed.",
      );
    const { workspaceKey, ark } = await this.context(credentialRevision);
    const row = await this.row(workspaceKey);
    if ((row?.revision ?? 0) !== revision || this.pending(row))
      throw new HttpError(
        409,
        "The workspace settings changed on another device or a change is unconfirmed. Refresh before saving.",
        this.pending(row) ? "settings_pending" : undefined,
      );
    const workspace = await this.decode(workspaceKey, row);
    const { collection, field } = kinds[kind];
    const id = workspace[field] as string | undefined;
    if (!id)
      throw new HttpError(409, "Prepare the workspace before changing it.");
    await this.quota(now, "update", UPDATE_LIMIT);
    const values = parsed.data as Record<string, unknown>;
    const keys = Object.keys(values).filter((key) => key !== "version");
    const pending: Pending = {
      op: "update",
      kind,
      nonce: crypto.randomUUID(),
      ...(kind === "agent" ? { base: values.version as number } : {}),
      keys,
      hash: fingerprint(values, keys),
      state: "sending",
      startedAt: now,
    };
    // Held before anything is sent: a second device fails here without a POST.
    const held = await this.write(
      workspaceKey,
      revision,
      workspace,
      pending,
      now,
    );
    const path = `/${collection}/${encodeURIComponent(id)}`;
    const leave = async (state: "unconfirmed" | "review") => {
      await this.write(
        workspaceKey,
        held,
        workspace,
        { ...pending, state },
        now,
      );
    };
    let response: Record<string, unknown>;
    try {
      response = await ark.request<Record<string, unknown>>(path, {
        method: "POST",
        body: JSON.stringify(values),
      });
    } catch (error) {
      let rejected =
        error instanceof ApiError &&
        REJECTED.filter((status) => status !== 409 && status !== 429).includes(
          error.status,
        );
      // An agent version conflict is a rejection only if the agent still has
      // the version the change was based on.
      if (error instanceof ApiError && error.status === 409 && kind === "agent")
        rejected = await ark
          .request<{ version?: unknown }>(path)
          .then((agent) => agent.version === pending.base)
          .catch(() => false);
      if (rejected) {
        await this.write(workspaceKey, held, workspace, null, now);
        throw new HttpError(
          422,
          `Ark refused the change (HTTP ${(error as ApiError).status}). Nothing was saved.`,
        );
      }
      await leave("unconfirmed");
      throw unconfirmed(
        "The change was sent but its result is unconfirmed. Check it before making another change; it was not repeated.",
      );
    }
    let current = response;
    if (
      current.id !== id ||
      settingsFields[kind].some(
        (key) => (kind === "agent" || key !== "version") && !(key in current),
      )
    )
      try {
        current = await ark.request<Record<string, unknown>>(path);
      } catch {
        await leave("unconfirmed");
        throw unconfirmed(
          "The change was sent but could not be read back. Check it before making another change; it was not repeated.",
        );
      }
    return this.settle(
      workspaceKey,
      held,
      workspace,
      kind,
      id,
      current,
      credentialRevision,
      now,
    );
  }
  // Seals what Ark reports for the account's agent or environment and releases
  // the record. Values referencing resources an account may not use are never
  // sealed; the change is left for review instead.
  private async settle(
    workspaceKey: string,
    held: number,
    workspace: AccountWorkspace,
    kind: "agent" | "environment",
    id: string,
    current: Record<string, unknown>,
    credentialRevision: number,
    now: number,
  ) {
    const settings = pick(current, settingsFields[kind]);
    const row = await this.row(workspaceKey);
    const pending = this.pending(row);
    const tooLarge = JSON.stringify(settings).length > 100_000;
    if (!usable(kind, settings) || tooLarge) {
      // Left for the user's review; the user can keep the saved settings.
      if (pending && "op" in pending)
        await this.write(
          workspaceKey,
          held,
          workspace,
          { ...pending, state: "review" },
          now,
        );
      throw new HttpError(
        409,
        tooLarge
          ? "The current settings are too large to save. Keep the saved settings or reduce them in Studio."
          : "The current settings reference resources an account cannot use, so they were not saved. Keep the saved settings or edit them in Studio.",
        "settings_review",
      );
    }
    const model = (settings.model as { id?: unknown } | undefined)?.id;
    // Sealing what Ark confirms also ends any drift for this resource.
    const drift = { ...workspace.drift };
    delete drift[kind];
    await this.write(
      workspaceKey,
      held,
      {
        ...workspace,
        [kind]: settings,
        drift: Object.keys(drift).length ? drift : undefined,
        ...(kind === "agent" && typeof model === "string" ? { model } : {}),
      },
      null,
      now,
    );
    // Background work pins the agent version it was allowed with. Rebinding
    // to the confirmed new version pauses the schedule until the user enables
    // it again.
    let background: "unchanged" | "rebound" | "stale" = "unchanged";
    const connections = new ConnectionStore(this.env, this.owner);
    const binding = await connections.resolve().catch(() => undefined);
    if (
      kind === "agent" &&
      binding?.revision &&
      binding.env.ARK_AGENT_ID === id &&
      typeof settings.version === "number" &&
      String(settings.version) !== binding.env.ARK_AGENT_VERSION
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
  // Resolves an unconfirmed change or a drift by reading Ark only; nothing is
  // sent to Ark. "adopt" seals Ark's current values and "discard" keeps the
  // saved settings; both are explicit user decisions.
  async reconcile(
    revision: number,
    credentialRevision: number,
    mode: "check" | "adopt" | "discard" = "check",
    now = Date.now(),
  ) {
    const { workspaceKey, ark } = await this.context(credentialRevision);
    const row = await this.row(workspaceKey);
    const pending = this.pending(row);
    if ((row?.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "The workspace settings changed on another device. Refresh before saving.",
      );
    const workspace = await this.decode(workspaceKey, row);
    const held = row!.revision;
    const update = pending && "op" in pending ? pending : undefined;
    // A change still being sent on another device is left alone.
    if (update?.state === "sending" && now - update.startedAt < SENDING_WINDOW)
      throw new HttpError(
        409,
        "A change is still being sent. Check again shortly.",
      );
    const drifted = Object.keys(workspace.drift ?? {}) as (
      "agent" | "environment"
    )[];
    const kind = update?.kind ?? drifted[0];
    if (!kind)
      throw new HttpError(409, "There is no unconfirmed change to check.");
    if (mode === "discard") {
      if (!update)
        throw new HttpError(409, "There is no unconfirmed change to discard.");
      // Keeps the saved settings, records that Ark may differ from them, and
      // stops background work until the user checks them. Nothing is sent.
      await this.write(
        workspaceKey,
        held,
        { ...workspace, drift: { ...workspace.drift, [kind]: now } },
        null,
        now,
        undefined,
        true,
      );
      return { ...(await this.read()), change: "discarded" as const };
    }
    const { collection, field, label } = kinds[kind];
    const id = workspace[field] as string;
    const current = await ark
      .request<Record<string, unknown> & { metadata?: Record<string, string> }>(
        `/${collection}/${encodeURIComponent(id)}`,
      )
      .catch(() => {
        throw unconfirmed("Ark could not be read. Nothing was changed.");
      });
    const review = async (message: string) => {
      if (update && update.state !== "review")
        await this.write(
          workspaceKey,
          held,
          workspace,
          { ...update, state: "review" },
          now,
        );
      throw new HttpError(409, message, "settings_review");
    };
    if (current.id !== id || current.metadata?.[label] !== workspaceKey)
      return review(
        "A workspace resource was changed outside Open Muse. Review it in the Ark console.",
      );
    const seal = async (change: "applied" | "adopted" | "drift_cleared") => ({
      ...(await this.settle(
        workspaceKey,
        held,
        workspace,
        kind,
        id,
        current,
        credentialRevision,
        now,
      )),
      change,
    });
    if (!update) {
      // Drift ends only when Ark matches the saved settings or the user
      // adopts Ark's usable values.
      if (mode === "adopt") return seal("adopted");
      const fields = settingsFields[kind];
      if (
        fingerprint(current, fields) ===
        fingerprint(workspace[kind] ?? {}, fields)
      )
        return seal("drift_cleared");
      return { ...(await this.read()), change: "drift_kept" as const };
    }
    const matches = fingerprint(current, update.keys) === update.hash;
    if (
      matches &&
      (kind !== "agent" || current.version === (update.base ?? 0) + 1)
    )
      return seal("applied");
    if (mode === "adopt" && update.state === "review") return seal("adopted");
    // An agent still at the base version had not taken the change when read.
    // A later arrival would change the version, so the next change based on
    // it fails and is checked again instead of being overwritten.
    if (kind === "agent" && current.version === update.base && !matches) {
      await this.write(workspaceKey, held, workspace, null, now);
      return { ...(await this.read()), change: "not_applied_yet" as const };
    }
    // Environments have no version: nothing proves a change did not apply.
    return review(
      "Ark's current settings could not be matched to the change. Review them, then save the current settings or keep the saved settings.",
    );
  }
}
