import { ApiError, ArkClient } from "../../shared/ark";
import {
  environmentWithTools,
  systemWithTools,
  type EnvironmentConfig,
} from "../../shared/tooling";
import type { WorkspaceStatus } from "../../shared/types";
import { LocalDatabase } from "./storage";
import { systemWithIdentity } from "../../shared/identity";

const system =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. Execute tools directly when the user requests them, without asking for additional tool permission confirmation; never bypass upstream denial policies, and never describe unexecuted operations as completed.";
const legacySystem =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. External writes, sending messages, transactions, and deletions require explicit confirmation; never describe unexecuted operations as completed.";
// A public tool-calling model, validated by MA when creating the agent. Existing
// agents keep their model. Do not depend on the inference catalog's broken CORS
// policy or infer model availability from an unverified local response.
export const DEFAULT_MODEL = "doubao-seed-2-0-pro-260215";
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
  async status(): Promise<WorkspaceStatus> {
    const row = await this.row();
    if (this.job)
      return {
        state: "preparing",
        message: row?.message || "Preparing your personal workspace…",
      };
    if (row?.state === "preparing")
      return {
        state: "error",
        message:
          "Preparation was interrupted. Resume to verify existing cloud resources first.",
      };
    return row
      ? { state: row.state, message: row.message }
      : {
          state: "idle",
          message:
            "Your agent and cloud environment will be created automatically on first use.",
        };
  }
  async selection() {
    const row = await this.row();
    if (!row?.agent_id || !row.environment_id || row.state !== "ready")
      throw new ApiError(
        409,
        "Prepare your personal workspace in Settings first.",
      );
    return { agent: row.agent_id, environment_id: row.environment_id };
  }
  async start() {
    if (!this.job)
      this.job = this.prepare()
        .catch(async (error) => {
          await this.update((row) => {
            row.state = "error";
            row.message =
              error instanceof Error
                ? error.message
                : "Preparation failed. Resume to verify existing resources.";
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
      throw new Error("Workspace preparation was cancelled.");
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
          "Unexpected cloud resource list. Creation was stopped.",
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
      "Could not read the complete resource list. Creation was stopped.",
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
          "Creation result is unconfirmed. Resume to check cloud resources.",
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
          "A previous creation is unconfirmed or another app is preparing this workspace. Resume later to verify it; no duplicate was created.",
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
  private async prepare() {
    await this.update((row) => {
      row.state = "preparing";
      row.message = "Checking your personal workspace…";
    });
    await this.ensure("environment", {
      description:
        "Personal cloud environment managed automatically by Open Muse",
      config: environmentWithTools({
        type: "cloud",
        networking: { type: "unrestricted" },
      }),
    });
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
    if (!(await this.row())!.model_id)
      await this.update((r) => {
        r.model_id = DEFAULT_MODEL;
      });
    await this.ensure("agent", {
      description: "Personal agent managed automatically by Open Muse",
      model: { id: (await this.row())!.model_id },
      system: systemWithIdentity(systemWithTools(system)),
      tools: [
        {
          type: "agent_toolset_20260701",
          default_config: { permission_policy: { type: "always_allow" } },
        },
      ],
    });
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
        await this.request(environmentPath, {
          method: "POST",
          body: JSON.stringify({ config }),
        });
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
        "Invalid agent version; no policy changes were submitted.",
      );
    await this.request(path, {
      method: "POST",
      body: JSON.stringify({
        version: agent.version,
        tools,
        system: updatedSystem,
      }),
    });
  }
}
