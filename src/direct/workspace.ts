import { t } from "../../shared/i18n";
import { ApiError, ArkClient } from "../../shared/ark";
import {
  environmentWithTools,
  systemWithTools,
  type EnvironmentConfig,
} from "../../shared/tooling";
import type { WorkspaceStatus } from "../../shared/types";
import { LocalDatabase } from "./storage";
import { systemWithIdentity } from "../../shared/identity";
import {
  DEFAULT_MODEL,
  MUSE_SYSTEM as system,
  agentSpec,
  environmentSpec,
} from "../../shared/workspace-spec";

export { DEFAULT_MODEL };
const legacySystem =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. External writes, sending messages, transactions, and deletions require explicit confirmation; never describe unexecuted operations as completed.";
const legacyDefaultModel = "doubao-seed-2-0-pro-260215";
type Kind = "agent" | "environment";
interface Mapping {
  agent_id: string;
  environment_id: string;
  model_id: string;
  resource_name: string;
  agent_pending: boolean;
  environment_pending: boolean;
  state: WorkspaceStatus["state"];
  message: string;
  review?: WorkspaceStatus["review"];
}
type Resource = {
  id: string;
  name?: string;
  metadata?: Record<string, string>;
};
export class DirectWorkspace {
  private job?: Promise<void>;
  private abort = new AbortController();
  private storageKey: string;
  constructor(
    private key: string,
    private ark: ArkClient,
    private db: LocalDatabase,
    // Account workspaces are created and recorded by the Open Muse service;
    // this client never discovers or creates them by label.
    private provision?: (options: {
      replaceUnconfirmed: boolean;
      resetSettings: boolean;
    }) => Promise<{ agentId: string; environmentId: string; model: string }>,
    // The account's sealed workspace record, read without creating anything.
    private lookup?: () => Promise<
      { agentId?: string; environmentId?: string; model: string } | undefined
    >,
    private apply?: (
      kind: "agent" | "environment",
      changes: Record<string, unknown>,
    ) => Promise<void>,
  ) {
    this.storageKey = `${key}:workspace`;
  }
  cancel() {
    this.abort.abort();
  }
  private row() {
    return this.db.get<Mapping>(this.storageKey);
  }
  private update(change: (row: Mapping) => void) {
    return this.db.update<Mapping>(this.storageKey, (current) => {
      const row = current ?? {
        agent_id: "",
        environment_id: "",
        model_id: "",
        resource_name: `open-muse-${this.key.slice(0, 18)}`,
        agent_pending: false,
        environment_pending: false,
        state: "idle",
        message: "",
      };
      change(row);
      return row;
    });
  }
  // An account's local row can predate service-created workspaces or come from
  // another key holder's relabelled resource. Once per runtime it is replaced
  // by the service's record; a differing row is kept aside, never used.
  private checked?: Promise<void>;
  private reconcile() {
    if (!this.lookup) return Promise.resolve();
    return (this.checked ??= (async () => {
      const record = await this.lookup!();
      const row = await this.row();
      const same =
        row?.agent_id === (record?.agentId ?? "") &&
        row?.environment_id === (record?.environmentId ?? "");
      if (same || (!row?.agent_id && !row?.environment_id && !record)) return;
      if (row?.agent_id || row?.environment_id)
        await this.db.set(`${this.storageKey}:unrecorded:${Date.now()}`, row);
      const complete = Boolean(record?.agentId && record.environmentId);
      await this.db.set<Mapping>(this.storageKey, {
        agent_id: record?.agentId ?? "",
        environment_id: record?.environmentId ?? "",
        model_id: record?.model ?? "",
        resource_name: `open-muse-${this.key.slice(0, 18)}`,
        agent_pending: false,
        environment_pending: false,
        state: complete ? "ready" : "idle",
        message: complete
          ? "Your personal workspace is ready; you can start a task."
          : "",
      });
    })().catch((error) => {
      this.checked = undefined;
      throw error;
    }));
  }
  async status(): Promise<WorkspaceStatus> {
    if (!this.job) await this.reconcile();
    const row = await this.row();
    if (this.job)
      return {
        state: "preparing",
        message: t(row?.message || "Preparing your personal workspace…"),
      };
    if (row?.state === "preparing")
      return {
        state: "error",
        message: t(
          "Preparation was interrupted. Resume to verify existing cloud resources first.",
        ),
      };
    return row
      ? {
          state: row.state,
          message: row.state === "error" ? row.message : t(row.message),
          ...(row.state === "error" && row.review
            ? { review: row.review }
            : {}),
        }
      : {
          state: "idle",
          message: t(
            "Your agent and cloud environment will be created automatically on first use.",
          ),
        };
  }
  async selection() {
    await this.reconcile();
    const row = await this.row();
    if (!row?.agent_id || !row.environment_id || row.state !== "ready")
      throw new ApiError(
        409,
        t("Prepare your personal workspace in Settings first."),
      );
    return { agent: row.agent_id, environment_id: row.environment_id };
  }
  // Both options are set only by an explicit user action: replaceUnconfirmed
  // lets the service abandon an unconfirmed earlier creation, resetSettings
  // recreates a deleted agent or environment with default settings when its
  // saved settings cannot be used.
  async start(
    options: { replaceUnconfirmed?: boolean; resetSettings?: boolean } = {},
  ) {
    if (!this.job)
      this.job = this.prepare({
        replaceUnconfirmed: options.replaceUnconfirmed === true,
        resetSettings: options.resetSettings === true,
      })
        .catch(async (error) => {
          const code = (error as { code?: string }).code;
          await this.update((row) => {
            row.state = "error";
            row.message =
              error instanceof Error
                ? error.message
                : t("Preparation failed. Resume to verify existing resources.");
            row.review =
              code === "rebuild_review"
                ? "rebuild"
                : code === "settings_review"
                  ? "settings"
                  : code === "settings_pending" || code === "unconfirmed"
                    ? "unconfirmed"
                    : undefined;
          });
        })
        .finally(() => {
          this.job = undefined;
        });
    return this.status();
  }
  async wait() {
    await this.job;
    const status = await this.status();
    if (status.state !== "ready") throw new Error(status.message);
  }
  private request<T>(path: string, init: RequestInit = {}) {
    if (this.abort.signal.aborted)
      throw new Error(t("Workspace preparation was cancelled."));
    return this.ark.request<T>(path, {
      ...init,
      signal: this.abort.signal,
    });
  }
  private async discover(kind: Kind) {
    let page = "";
    const seen = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const result = await this.request<{
        data: Resource[];
        next_page?: string;
      }>(
        `/${kind}s?limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`,
      );
      if (!Array.isArray(result.data))
        throw new ApiError(
          502,
          t("Unexpected cloud resource list. Creation was stopped."),
        );
      const owned = result.data
        .filter(
          (resource) => resource.metadata?.open_muse_workspace === this.key,
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      if (owned.length) return owned[0];
      if (!result.next_page) return;
      if (seen.has(result.next_page)) break;
      page = result.next_page;
      seen.add(page);
    }
    throw new ApiError(
      502,
      t("Could not read the complete resource list. Creation was stopped."),
    );
  }
  private async ensure(kind: Kind, body: object) {
    let row = (await this.row())!;
    if (row[`${kind}_id`]) {
      try {
        await this.request(
          `/${kind}s/${encodeURIComponent(row[`${kind}_id`])}`,
        );
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        row = await this.update((r) => {
          r[`${kind}_id`] = "";
          r[`${kind}_pending`] = false;
        });
      }
    }
    const record = async (resource: Resource) => {
      if (!resource.id || !/^[\w-]+$/.test(resource.id))
        throw new ApiError(
          502,
          t("Creation result is unconfirmed. Resume to check cloud resources."),
        );
      await this.update((r) => {
        r[`${kind}_id`] = resource.id;
        r[`${kind}_pending`] = false;
      });
    };
    // Also recovers workspaces from the previous server-backed app and other
    // devices. Never adopt a resource based on a name alone.
    const existing = await this.discover(kind);
    if (existing) {
      await record(existing);
      return;
    }
    row = await this.update((r) => {
      if (r[`${kind}_id`] || r[`${kind}_pending`])
        throw new ApiError(
          409,
          t(
            "A previous creation is unconfirmed or another app is preparing this workspace. Resume later to verify it; no duplicate was created.",
          ),
        );
      r[`${kind}_pending`] = true;
      r.message = `Preparing your ${kind}…`;
    });
    try {
      await record(
        await this.request<Resource>(`/${kind}s`, {
          method: "POST",
          body: JSON.stringify({
            ...body,
            name: `${row.resource_name}-${kind}`,
            metadata: { open_muse_workspace: this.key },
          }),
        }),
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status)
      )
        await this.update((r) => {
          r[`${kind}_pending`] = false;
        });
      throw error;
    }
  }
  private async prepare(options: {
    replaceUnconfirmed: boolean;
    resetSettings: boolean;
  }) {
    await this.update((row) => {
      row.state = "preparing";
      row.message = "Checking your personal workspace…";
      row.review = undefined;
    });
    if (this.provision) {
      await this.reconcile();
      const created = await this.provision(options);
      await this.update((r) => {
        r.agent_id = created.agentId;
        r.environment_id = created.environmentId;
        r.model_id = created.model;
        r.agent_pending = r.environment_pending = false;
      });
      await this.syncPolicy();
      await this.update((r) => {
        r.state = "ready";
        r.message = "Your personal workspace is ready; you can start a task.";
      });
      return;
    }
    await this.ensure("environment", environmentSpec());
    const row = (await this.row())!;
    // Recover the existing agent without depending on model catalog access.
    if (!row.agent_id) {
      const existing = await this.discover("agent");
      if (existing)
        await this.update((r) => {
          r.agent_id = existing.id;
          r.agent_pending = false;
        });
    }
    const modelRow = (await this.row())!;
    // Only repair an uncreated assistant's former default. Adopted agents and
    // custom model selections are preserved, including unconfirmed creations.
    if (
      !modelRow.model_id ||
      (!modelRow.agent_id &&
        !modelRow.agent_pending &&
        modelRow.model_id === legacyDefaultModel)
    )
      await this.update((r) => {
        r.model_id = DEFAULT_MODEL;
      });
    await this.ensure("agent", agentSpec((await this.row())!.model_id));
    await this.syncPolicy();
    await this.update((r) => {
      r.state = "ready";
      r.message = "Your personal workspace is ready; you can start a task.";
    });
  }
  async syncPolicy() {
    const row = await this.row();
    if (!row?.agent_id || !row.environment_id) return;
    const environmentPath = `/environments/${encodeURIComponent(row.environment_id)}`;
    const environment = await this.request<
      Resource & { config?: EnvironmentConfig }
    >(environmentPath);
    const owned =
      environment.metadata?.open_muse_workspace === this.key &&
      environment.config?.type === "cloud";
    if (owned) {
      const config = environmentWithTools(environment.config!);
      if (JSON.stringify(config) !== JSON.stringify(environment.config))
        await this.change("environment", environmentPath, { config });
    }
    const path = `/agents/${encodeURIComponent(row.agent_id)}`;
    const agent = await this.request<
      Resource & {
        version?: number;
        system?: string;
        tools?: {
          type: string;
          default_config?: { permission_policy?: { type: string } };
        }[];
      }
    >(path);
    if (agent.metadata?.open_muse_workspace !== this.key) return;
    const tools = agent.tools?.map((tool) =>
      tool.type === "agent_toolset_20260701" &&
      tool.default_config?.permission_policy?.type === "always_ask"
        ? {
            ...tool,
            default_config: {
              ...tool.default_config,
              permission_policy: {
                ...tool.default_config.permission_policy,
                type: "always_allow",
              },
            },
          }
        : tool,
    );
    const baseSystem =
      agent.system === legacySystem ? system : (agent.system ?? system);
    const updatedSystem = systemWithIdentity(
      owned ? systemWithTools(baseSystem) : baseSystem,
    );
    if (
      JSON.stringify(tools) === JSON.stringify(agent.tools) &&
      updatedSystem === agent.system
    )
      return;
    if (!agent.version || !Number.isInteger(agent.version))
      throw new ApiError(
        502,
        t("Invalid agent version; no policy changes were submitted."),
      );
    await this.change("agent", path, {
      version: agent.version,
      tools,
      system: updatedSystem,
    });
  }
  // Account workspaces change their agent and environment through the service
  // so the resulting settings are sealed with the account.
  private async change(
    kind: "agent" | "environment",
    path: string,
    changes: Record<string, unknown>,
  ) {
    if (this.apply) await this.apply(kind, changes);
    else
      await this.request(path, {
        method: "POST",
        body: JSON.stringify(changes),
      });
  }
}
