import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "./ark";
import { isSSOCredentials } from "./oauth";
import type { Runtime } from "./ma";
import type { WorkspaceStatus } from "../shared/types";
import {
  environmentWithTools,
  systemWithTools,
  type EnvironmentConfig,
} from "./tooling";
const agentSystem =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. Execute tools directly when the user requests them, without asking for additional tool permission confirmation; never bypass upstream denial policies, and never describe unexecuted operations as completed.";
const legacyAgentSystem =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. External writes, sending messages, transactions, and deletions require explicit confirmation; never describe unexecuted operations as completed.";

type AgentResource = Resource & {
  version?: number;
  system?: string;
  tools?: Array<{
    type?: string;
    default_config?: { permission_policy?: { type?: string } };
  }>;
};

type Kind = "agent" | "environment";
interface Mapping {
  workspace_key: string;
  agent_id: string;
  environment_id: string;
  model_id: string;
  resource_name: string;
  agent_pending: number;
  environment_pending: number;
  state: WorkspaceStatus["state"];
  message: string;
}
type Resource = {
  id: string;
  name?: string;
  metadata?: Record<string, string>;
};

// Credentials only participate in an irreversible digest and are never written to SQLite; different upstreams, keys, or projects never share a mapping.
export function workspaceKey(runtime: Runtime) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        runtime.config.arkBaseUrl,
        runtime.config.arkKey,
        runtime.credentials?.project ?? runtime.config.project,
      ]),
    )
    .digest("hex");
}

export class Workspaces {
  private db: DatabaseSync;
  private jobs = new Map<
    string,
    { promise: Promise<void>; abort: AbortController }
  >();
  private closed = false;
  private policyJobs = new Map<string, Promise<void>>();
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "workspaces.sqlite");
    closeSync(openSync(file, "a", 0o600));
    chmodSync(file, 0o600);
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_key TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL DEFAULT '',
        environment_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        resource_name TEXT NOT NULL,
        agent_pending INTEGER NOT NULL DEFAULT 0,
        environment_pending INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'idle',
        message TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }
  private row(key: string) {
    return this.db
      .prepare("SELECT * FROM workspaces WHERE workspace_key = ?")
      .get(key) as unknown as Mapping | undefined;
  }
  private save(row: Mapping) {
    if (this.closed) return;
    this.db
      .prepare(
        `UPDATE workspaces SET agent_id = ?, environment_id = ?, model_id = ?,
      agent_pending = ?, environment_pending = ?, state = ?, message = ?, updated_at = ?
      WHERE workspace_key = ?`,
      )
      .run(
        row.agent_id,
        row.environment_id,
        row.model_id,
        row.agent_pending,
        row.environment_pending,
        row.state,
        row.message,
        new Date().toISOString(),
        row.workspace_key,
      );
  }
  selection(runtime: Runtime) {
    const row = this.row(workspaceKey(runtime));
    if (row?.agent_id && row.environment_id)
      return { agent: row.agent_id, environment_id: row.environment_id };
    const legacy = runtime.store.data.selection;
    const credentials =
      runtime.credentials && isSSOCredentials(runtime.credentials)
        ? runtime.credentials
        : undefined;
    const agent =
      credentials?.agentId || legacy?.agent || runtime.config.agentId;
    const environment_id =
      credentials?.environmentId ||
      legacy?.environment_id ||
      runtime.config.environmentId;
    return agent && environment_id ? { agent, environment_id } : undefined;
  }
  status(runtime: Runtime): WorkspaceStatus {
    if (runtime.config.mode !== "ark")
      return {
        state: "demo",
        message:
          "After signing in and connecting a project, your personal workspace is prepared automatically.",
      };
    const key = workspaceKey(runtime);
    const row = this.row(key);
    if (this.jobs.has(key))
      return {
        state: "preparing",
        message: row?.message || "Preparing your personal workspace…",
      };
    if (row?.state === "preparing")
      return {
        state: "error",
        message:
          "The previous preparation was interrupted. Resuming will first verify the resources already created.",
      };
    if (row?.state === "error") return { state: "error", message: row.message };
    if (this.selection(runtime))
      return {
        state: "ready",
        message: "Your personal workspace is ready; you can start a task.",
      };
    return {
      state: "idle",
      message:
        "On first use, an agent and a cloud environment are created automatically.",
    };
  }
  start(runtime: Runtime) {
    if (runtime.config.mode !== "ark")
      throw new ApiError(409, "Sign in and connect an Ark project first.");
    const key = workspaceKey(runtime);
    if (this.closed)
      throw new ApiError(
        503,
        "The app is shutting down; reopen it to continue.",
      );
    if (!this.jobs.has(key)) {
      const abort = new AbortController();
      const promise = this.prepare(runtime, abort.signal)
        .catch((error: unknown) => {
          if (this.closed) return;
          const row = this.row(key);
          if (row) {
            row.state = "error";
            row.message = abort.signal.aborted
              ? "Preparation was interrupted; reconnect to continue."
              : error instanceof ApiError
                ? error.message
                : "Workspace preparation failed; completed steps were saved. Please resume later.";
            this.save(row);
          }
        })
        .finally(() => this.jobs.delete(key));
      this.jobs.set(key, { promise, abort });
    }
    return this.status(runtime);
  }
  async wait(runtime: Runtime) {
    await this.jobs.get(workspaceKey(runtime))?.promise;
    return this.status(runtime);
  }
  async syncToolPolicy(runtime: Runtime, signal?: AbortSignal) {
    const key = workspaceKey(runtime);
    const row = this.row(key);
    if (!row?.agent_id) return;
    const pending = this.policyJobs.get(key);
    if (pending) return pending;
    const job = (async () => {
      const environmentPath = `/environments/${encodeURIComponent(row.environment_id)}`;
      const environment = await runtime.ark.request<
        Resource & { config?: EnvironmentConfig }
      >(environmentPath, { signal });
      const managedCloud =
        environment.metadata?.open_muse_workspace === key &&
        environment.config?.type === "cloud";
      if (managedCloud) {
        const config = environmentWithTools(environment.config!);
        if (JSON.stringify(config) !== JSON.stringify(environment.config))
          await runtime.ark.request(environmentPath, {
            method: "POST",
            signal,
            body: JSON.stringify({ config }),
          });
      }
      const path = `/agents/${encodeURIComponent(row.agent_id)}`;
      const agent = await runtime.ark.request<AgentResource>(path, { signal });
      // Only sync resources created by this app; never modify manually onboarded or same-named external agents.
      if (agent.metadata?.open_muse_workspace !== key) return;
      let changed = false;
      const tools = agent.tools?.map((tool) => {
        const current = tool.default_config?.permission_policy?.type;
        if (tool.type !== "agent_toolset_20260701" || current !== "always_ask")
          return tool;
        changed = true;
        return {
          ...tool,
          default_config: {
            ...tool.default_config,
            permission_policy: {
              ...tool.default_config?.permission_policy,
              type: "always_allow",
            },
          },
        };
      });
      const baseSystem =
        agent.system === legacyAgentSystem ? agentSystem : agent.system;
      const system = managedCloud
        ? systemWithTools(baseSystem ?? agentSystem)
        : baseSystem;
      const body: Record<string, unknown> = {};
      if (changed) body.tools = tools;
      if (system !== agent.system) body.system = system;
      if (!Object.keys(body).length) return;
      if (!Number.isInteger(agent.version) || agent.version! < 1)
        throw new ApiError(
          502,
          "Invalid agent version; tool permissions were not changed. Please try again later.",
        );
      await runtime.ark.request(path, {
        method: "POST",
        signal,
        body: JSON.stringify({ ...body, version: agent.version }),
      });
    })();
    this.policyJobs.set(key, job);
    try {
      await job;
    } finally {
      this.policyJobs.delete(key);
    }
  }
  cancel(runtime: Runtime) {
    this.jobs.get(workspaceKey(runtime))?.abort.abort();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.jobs.values()) job.abort.abort();
    this.db.close();
  }
  private async prepare(runtime: Runtime, signal: AbortSignal) {
    const key = workspaceKey(runtime);
    const legacy = runtime.store.data.selection;
    const credentials =
      runtime.credentials && isSSOCredentials(runtime.credentials)
        ? runtime.credentials
        : undefined;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO workspaces
      (workspace_key, resource_name, agent_id, environment_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        key,
        `open-muse-${randomUUID().slice(0, 18)}`,
        credentials?.agentId || legacy?.agent || runtime.config.agentId,
        credentials?.environmentId ||
          legacy?.environment_id ||
          runtime.config.environmentId,
        new Date().toISOString(),
      );
    const row = this.row(key)!;
    const request = <T>(path: string, init: RequestInit = {}) => {
      signal.throwIfAborted();
      return runtime.ark.request<T>(path, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    };
    const step = (message: string) => {
      signal.throwIfAborted();
      row.state = "preparing";
      row.message = message;
      this.save(row);
    };
    step("Checking your personal workspace…");
    for (const kind of ["environment", "agent"] as const) {
      const id = row[`${kind}_id`];
      if (!id) continue;
      try {
        await request(`/${kind}s/${encodeURIComponent(id)}`);
      } catch (error) {
        // Recreate only on an explicit 404; permission errors or network failures must not be treated as a missing resource.
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        row[`${kind}_id`] = "";
        row[`${kind}_pending`] = 0;
        this.save(row);
      }
    }
    const ensure = async (kind: Kind, body: object) => {
      if (row[`${kind}_id`]) return;
      step(
        kind === "agent"
          ? "Preparing your agent…"
          : "Preparing your cloud environment…",
      );
      const recover = async () => {
        let page = "";
        const seen = new Set<string>();
        for (let i = 0; i < 100; i++) {
          const result = await request<{
            data: Resource[];
            next_page?: string;
          }>(
            `/${kind}s?limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`,
          );
          if (!Array.isArray(result.data))
            throw new ApiError(
              502,
              "The cloud resource list has an unexpected format; creation was stopped. Please try again later.",
            );
          const found = result.data.find(
            (r) =>
              r.name === `${row.resource_name}-${kind}` &&
              r.metadata?.open_muse_workspace === key,
          );
          if (found) return found;
          if (!result.next_page) return undefined;
          if (seen.has(result.next_page)) break;
          page = result.next_page;
          seen.add(page);
        }
        throw new ApiError(
          502,
          "The cloud resource list could not be read completely; creation was stopped. Please try again later.",
        );
      };
      const record = (resource: Resource) => {
        if (typeof resource.id !== "string" || !/^[\w-]+$/.test(resource.id))
          throw new ApiError(
            502,
            "The cloud did not return a valid resource identifier. The result is unconfirmed; resuming will verify the resources first.",
          );
        signal.throwIfAborted();
        row[`${kind}_id`] = resource.id;
        row[`${kind}_pending`] = 0;
        this.save(row);
      };
      if (row[`${kind}_pending`]) {
        const found = await recover();
        if (found) {
          record(found);
          return;
        }
        throw new ApiError(
          409,
          "The previous creation result is unconfirmed, so it will not be recreated. Click resume later to verify the cloud resources.",
        );
      }
      row[`${kind}_pending`] = 1;
      this.save(row); // Record before sending the request, so a process crash never loses the uncertain state.
      try {
        record(
          await request<Resource>(`/${kind}s`, {
            method: "POST",
            body: JSON.stringify({
              ...body,
              name: `${row.resource_name}-${kind}`,
              metadata: { open_muse_workspace: key },
            }),
          }),
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          [400, 401, 403, 404, 413, 429].includes(error.status)
        ) {
          row[`${kind}_pending`] = 0;
          this.save(row);
        }
        throw error;
      }
    };
    if (!row.agent_id && !row.model_id && !row.agent_pending) {
      step("Selecting a model that supports tool calls…");
      row.model_id =
        runtime.config.modelId || chooseModel(await request("/models"));
      this.save(row);
    }
    await ensure("environment", {
      description:
        "Personal cloud environment managed automatically by Open Muse",
      config: environmentWithTools({
        type: "cloud",
        networking: {
          // Network access and tool permissions are configured separately.
          type: "unrestricted",
        },
      }),
    });
    await ensure("agent", {
      description: "Personal agent managed automatically by Open Muse",
      model: { id: row.model_id },
      system: systemWithTools(agentSystem),
      tools: [
        {
          type: "agent_toolset_20260701",
          default_config: {
            permission_policy: {
              type: "always_allow",
            },
          },
        },
      ],
    });
    await this.syncToolPolicy(runtime, signal);
    step("Your personal workspace is ready; you can start a task.");
    row.state = "ready";
    this.save(row);
  }
}

export function chooseModel(result: unknown): string {
  type Model = {
    id: string;
    status?: string;
    task_type?: string[];
    modalities?: { output_modalities?: string[] };
    features?: { tools?: { function_calling?: boolean } };
    token_limits?: { context_window?: number };
  };
  const data = (result as { data?: Model[] } | null)?.data;
  const models = Array.isArray(data)
    ? data.filter(
        (m) =>
          typeof m.id === "string" &&
          m.id &&
          m.status !== "Shutdown" &&
          m.task_type?.includes("TextGeneration") &&
          m.features?.tools?.function_calling === true &&
          (!m.modalities || m.modalities.output_modalities?.includes("text")),
      )
    : [];
  models.sort(
    (a, b) =>
      (b.token_limits?.context_window ?? 0) -
        (a.token_limits?.context_window ?? 0) || a.id.localeCompare(b.id),
  );
  if (!models.length)
    throw new ApiError(
      409,
      "No tool-calling model is available in the current project. Enable a model in Ark, or have the server administrator configure ARK_MODEL_ID before resuming.",
    );
  return models[0].id;
}
