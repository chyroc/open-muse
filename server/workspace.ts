import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "./ark";
import { isSSOCredentials } from "./oauth";
import type { Runtime } from "./ma";
import type { WorkspaceStatus } from "../shared/types";

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

// 凭据只参与不可逆摘要，不写入 SQLite；不同上游、Key、项目不会共用映射。
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
        message: "登录并连接项目后，自动准备个人工作空间。",
      };
    const key = workspaceKey(runtime);
    const row = this.row(key);
    if (this.jobs.has(key))
      return {
        state: "preparing",
        message: row?.message || "正在准备个人工作空间…",
      };
    if (row?.state === "preparing")
      return {
        state: "error",
        message: "上次准备被中断。继续准备时会先核对已创建的资源。",
      };
    if (row?.state === "error") return { state: "error", message: row.message };
    if (this.selection(runtime))
      return { state: "ready", message: "个人工作空间已就绪，可以开始任务。" };
    return {
      state: "idle",
      message: "首次使用时会自动创建助手和云端运行环境。",
    };
  }
  start(runtime: Runtime) {
    if (runtime.config.mode !== "ark")
      throw new ApiError(409, "请先登录并连接方舟项目。");
    const key = workspaceKey(runtime);
    if (this.closed)
      throw new ApiError(503, "应用正在关闭，请重新打开后继续。");
    if (!this.jobs.has(key)) {
      const abort = new AbortController();
      const promise = this.prepare(runtime, abort.signal)
        .catch((error: unknown) => {
          if (this.closed) return;
          const row = this.row(key);
          if (row) {
            row.state = "error";
            row.message = abort.signal.aborted
              ? "准备已中断，重新连接后可继续。"
              : error instanceof ApiError
                ? error.message
                : "工作空间准备失败，已保存完成的步骤。请稍后继续准备。";
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
    step("正在检查个人工作空间…");
    for (const kind of ["environment", "agent"] as const) {
      const id = row[`${kind}_id`];
      if (!id) continue;
      try {
        await request(`/${kind}s/${encodeURIComponent(id)}`);
      } catch (error) {
        // 只有明确的 404 才重新创建；无权限或网络故障不能当作资源不存在。
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        row[`${kind}_id`] = "";
        row[`${kind}_pending`] = 0;
        this.save(row);
      }
    }
    const ensure = async (kind: Kind, body: object) => {
      if (row[`${kind}_id`]) return;
      step(kind === "agent" ? "正在准备你的助手…" : "正在准备云端运行环境…");
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
              "云端资源列表格式异常，未继续创建。请稍后重试。",
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
          "云端资源列表未能完整读取，未继续创建。请稍后重试。",
        );
      };
      const record = (resource: Resource) => {
        if (typeof resource.id !== "string" || !/^[\w-]+$/.test(resource.id))
          throw new ApiError(
            502,
            "云端未返回有效资源标识。结果尚未确认，继续准备时将先核对资源。",
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
          "上次创建结果尚未确认，暂不重复创建。请稍后点击继续准备以核对云端资源。",
        );
      }
      row[`${kind}_pending`] = 1;
      this.save(row); // 请求发送前记录，进程中断也不会丢失不确定状态。
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
      step("正在选择支持工具调用的模型…");
      row.model_id =
        runtime.config.modelId || chooseModel(await request("/models"));
      this.save(row);
    }
    await ensure("environment", {
      description: "Open Muse 自动管理的个人云环境",
      config: {
        type: "cloud",
        networking: {
          // 当前线上创建接口只接受 unrestricted；工具权限仍单独设为逐次审批。
          type: "unrestricted",
        },
      },
    });
    await ensure("agent", {
      description: "Open Muse 自动管理的个人助手",
      model: { id: row.model_id },
      system:
        "你是 Open Muse，帮助用户研究、写作和规划。使用用户的语言，准确说明依据与不确定性。外部写入、发送消息、交易和删除必须获得明确确认，不把未执行的操作描述为已完成。",
      tools: [
        {
          type: "agent_toolset_20260701",
          default_config: { permission_policy: { type: "always_ask" } },
        },
      ],
    });
    step("个人工作空间已就绪，可以开始任务。");
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
      "当前项目没有可用的工具调用模型。请在方舟开通模型，或由服务管理员配置 ARK_MODEL_ID 后继续准备。",
    );
  return models[0].id;
}
