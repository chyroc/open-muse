import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ArkClient } from "../server/ark";
import { loadConfig } from "../server/config";
import { Store } from "../server/store";
import { chooseModel, Workspaces, workspaceKey } from "../server/workspace";
import type { Runtime } from "../server/ma";
import request from "supertest";
import { createApp } from "../server/app";

let dir: string;
let workspaces: Workspaces;
let runtime: Runtime;
type TestResource = {
  id: string;
  name: string;
  metadata: object;
  version?: number;
  system?: string;
  tools?: Array<Record<string, any>>;
};
let resources: Record<string, TestResource[]>;
const models = {
  data: [
    {
      id: "text-tools",
      status: "Published",
      task_type: ["TextGeneration"],
      features: { tools: { function_calling: true } },
    },
  ],
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "open-muse-workspace-"));
  const config = loadConfig({
    MUSE_MODE: "ark",
    ARK_API_KEY: "private-key",
    MUSE_DATA_DIR: dir,
  });
  const ark = new ArkClient(config);
  const store = new Store(dir, "ark");
  await store.init();
  runtime = { config, ark, store };
  resources = { agents: [], environments: [] };
  vi.spyOn(ark, "request").mockImplementation(async (path, init) => {
    if (path === "/models") return models as never;
    const collection = path.split(/[/?]/)[1];
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const id = path.split("/")[2];
      if (id) {
        const item = resources[collection].find((r) => r.id === id)!;
        if (body.version !== item.version)
          throw new ApiError(409, "version conflict");
        Object.assign(item, body, { version: body.version + 1 });
        return item as never;
      }
      const value = {
        ...body,
        id: `${collection}-${resources[collection].length + 1}`,
        version: 1,
      };
      resources[collection].push(value);
      return value as never;
    }
    if (path.includes("?")) return { data: resources[collection] } as never;
    const item = resources[collection].find((r) => r.id === path.split("/")[2]);
    if (!item) throw new ApiError(404, "not found");
    return item as never;
  });
  workspaces = new Workspaces(dir);
});
afterEach(async () => {
  workspaces.close();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const posts = () =>
  vi
    .mocked(runtime.ark.request)
    .mock.calls.filter(([, init]) => init?.method === "POST");
async function prepare() {
  workspaces.start(runtime);
  return workspaces.wait(runtime);
}

describe("自动工作空间与 SQLite 映射", () => {
  it("无 ID 自动创建、采用云环境和审批策略，不把 ID/密钥返回普通客户端", async () => {
    expect(workspaces.status(runtime).state).toBe("idle");
    expect(runtime.ark.request).not.toHaveBeenCalled();
    const status = await prepare();
    expect(status.state).toBe("ready");
    expect(workspaces.selection(runtime)).toEqual({
      agent: "agents-1",
      environment_id: "environments-1",
    });
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[0][1]?.body)).config).toEqual({
      type: "cloud",
      networking: { type: "unrestricted" },
    });
    expect(JSON.parse(String(posts()[1][1]?.body)).tools[0].type).toBe(
      "agent_toolset_20260701",
    );
    expect(
      JSON.parse(String(posts()[1][1]?.body)).tools[0].default_config
        .permission_policy.type,
    ).toBe("always_allow");
    expect(JSON.stringify(status)).not.toMatch(
      /agents-1|environments-1|private-key/,
    );
    expect((await stat(join(dir, "workspaces.sqlite"))).mode & 0o777).toBe(
      0o600,
    );
    expect(
      (await readFile(join(dir, "workspaces.sqlite"))).includes(
        Buffer.from("private-key"),
      ),
    ).toBe(false);
  });
  it("重启复用 SQLite 映射，重复准备不重复创建", async () => {
    await prepare();
    workspaces.close();
    workspaces = new Workspaces(dir);
    expect(workspaces.status(runtime).state).toBe("ready");
    await prepare();
    expect(posts()).toHaveLength(2);
  });
  it("已有助手按版本更新权限与默认提示词，保留工具配置且不新建资源", async () => {
    await prepare();
    const agent = resources.agents[0];
    agent.tools![0].default_config.permission_policy.type = "always_ask";
    agent.system =
      "你是 Open Muse，帮助用户研究、写作和规划。使用用户的语言，准确说明依据与不确定性。外部写入、发送消息、交易和删除必须获得明确确认，不把未执行的操作描述为已完成。";
    agent.tools![0].configs = [
      { name: "delete_file", permission_policy: { type: "always_deny" } },
    ];
    agent.tools!.push({ type: "custom", name: "keep" });
    await Promise.all([
      workspaces.syncToolPolicy(runtime),
      workspaces.syncToolPolicy(runtime),
    ]);
    expect(posts()).toHaveLength(3);
    expect(resources.agents).toHaveLength(1);
    expect(resources.environments).toHaveLength(1);
    expect(agent.version).toBe(2);
    expect(agent.tools![0].default_config.permission_policy.type).toBe(
      "always_allow",
    );
    expect(agent.tools![0].configs[0].permission_policy.type).toBe(
      "always_deny",
    );
    expect(agent.tools![1]).toEqual({ type: "custom", name: "keep" });
    expect(agent.system).toContain("不额外请求工具权限确认");
    expect(JSON.parse(String(posts()[2][1]?.body))).toEqual({
      version: 1,
      tools: agent.tools,
      system: agent.system,
    });
    await prepare();
    expect(posts()).toHaveLength(3);
  });
  it("不覆盖自定义提示词、默认拒绝或外部资源", async () => {
    await prepare();
    const agent = resources.agents[0];
    agent.system = "custom system";
    agent.tools![0].default_config.permission_policy.type = "always_deny";
    await workspaces.syncToolPolicy(runtime);
    expect(posts()).toHaveLength(2);
    agent.metadata = {};
    agent.tools![0].default_config.permission_policy.type = "always_ask";
    await workspaces.syncToolPolicy(runtime);
    expect(posts()).toHaveLength(2);
    expect(agent.system).toBe("custom system");
  });
  it("无有效版本不更新，权限同步失败不新建替代资源", async () => {
    await prepare();
    resources.agents[0].version = undefined;
    resources.agents[0].tools![0].default_config.permission_policy.type =
      "always_ask";
    expect((await prepare()).state).toBe("error");
    expect(posts()).toHaveLength(2);
    expect(resources.agents).toHaveLength(1);
  });
  it("同一连接的并发准备合并为一个任务", async () => {
    await Promise.all(Array.from({ length: 8 }, () => prepare()));
    expect(posts()).toHaveLength(2);
    expect(workspaces.status(runtime).state).toBe("ready");
  });
  it("上游地址、密钥、项目分别隔离，SQLite 只保存摘要", async () => {
    await prepare();
    for (const changed of [
      { ...runtime, config: { ...runtime.config, arkKey: "other-key" } },
      {
        ...runtime,
        config: {
          ...runtime.config,
          arkBaseUrl: "https://other.example/api/v3",
        },
      },
      { ...runtime, credentials: { project: "other-project" } } as Runtime,
      { ...runtime, config: { ...runtime.config, project: "other-project" } },
    ]) {
      expect(workspaceKey(changed)).not.toBe(workspaceKey(runtime));
      expect(workspaces.selection(changed)).toBeUndefined();
    }
  });
  it("部分失败保留已建环境，恢复时只创建缺失助手", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    let denied = true;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/agents" && denied) {
        denied = false;
        throw new ApiError(403, "无权限");
      }
      return original(path, init);
    });
    expect((await prepare()).state).toBe("error");
    expect(resources.environments).toHaveLength(1);
    expect((await prepare()).state).toBe("ready");
    expect(resources.environments).toHaveLength(1);
    expect(resources.agents).toHaveLength(1);
  });
  it("云端成功但响应丢失：重启后按标记恢复，不重复 POST", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    let lost = true;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      const value = await original(path, init);
      if (path === "/environments" && lost) {
        lost = false;
        throw new Error("network timeout");
      }
      return value;
    });
    expect((await prepare()).state).toBe("error");
    workspaces.close();
    workspaces = new Workspaces(dir);
    expect((await prepare()).state).toBe("ready");
    expect(posts()).toHaveLength(2);
  });
  it("结果不明且列表未查到时不盲目重建，不认领同名外部资源", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/environments") {
        const body = JSON.parse(String(init?.body));
        resources.environments.push({
          id: "foreign",
          name: body.name,
          metadata: {},
        });
        throw new Error("lost");
      }
      return original(path, init);
    });
    await prepare();
    expect((await prepare()).message).toContain("暂不重复创建");
    expect(posts()).toHaveLength(1);
  });
  it("仅在明确 404 后补建，403 与 502 不触发重建", async () => {
    await prepare();
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    for (const status of [403, 502]) {
      vi.mocked(runtime.ark.request).mockRejectedValue(
        new ApiError(status, "upstream unavailable"),
      );
      expect((await prepare()).state).toBe("error");
      expect(posts()).toHaveLength(2);
    }
    vi.mocked(runtime.ark.request).mockImplementation(original);
    resources.agents = [];
    expect((await prepare()).state).toBe("ready");
    expect(posts()).toHaveLength(3);
  });
  it("旧版默认配置迁入 SQLite，不创建替代资源", async () => {
    runtime.store.data.selection = {
      agent: "old-agent",
      environment_id: "old-env",
    };
    resources.agents.push({ id: "old-agent", name: "existing", metadata: {} });
    resources.environments.push({
      id: "old-env",
      name: "existing",
      metadata: {},
    });
    expect((await prepare()).state).toBe("ready");
    runtime.store.data.selection = undefined;
    workspaces.close();
    workspaces = new Workspaces(dir);
    expect(workspaces.selection(runtime)).toEqual({
      agent: "old-agent",
      environment_id: "old-env",
    });
    expect(posts()).toHaveLength(0);
  });
  it("模型不可用不创建资源，管理员可配置模型而不提供资源 ID", async () => {
    vi.mocked(runtime.ark.request).mockResolvedValueOnce({ data: [] });
    expect((await prepare()).message).toContain("没有可用");
    expect(posts()).toHaveLength(0);
    runtime.config.modelId = "configured-model";
    expect((await prepare()).state).toBe("ready");
    expect(JSON.parse(String(posts()[1][1]?.body)).model.id).toBe(
      "configured-model",
    );
  });
  it("中断后不继续创建后续资源", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/environments") workspaces.cancel(runtime);
      return original(path, init);
    });
    expect((await prepare()).state).toBe("error");
    expect(posts()).toHaveLength(1);
    expect(resources.agents).toHaveLength(0);
  });
  it("公开流程只需 prepare，再创建任务时服务端填入映射", async () => {
    const app = await createApp(runtime.config, { ark: runtime.ark });
    try {
      const start = await request(app.app)
        .post("/api/workspace/prepare")
        .send({})
        .expect(202);
      expect(start.body).not.toHaveProperty("agent_id");
      let state = "preparing";
      for (let i = 0; i < 20 && state === "preparing"; i++)
        state = (await request(app.app).get("/api/workspace")).body.state;
      expect(state).toBe("ready");
      const create = vi.spyOn(runtime.ark, "create").mockResolvedValue({
        id: "session-test",
        title: "hello",
        category: "general",
        status: "idle",
        created_at: "now",
        updated_at: "now",
      });
      await request(app.app)
        .post("/api/sessions")
        .send({ title: "hello" })
        .expect(201);
      expect(create).toHaveBeenCalledWith("hello", "general", {
        agent: "agents-1",
        environment_id: "environments-1",
      });
    } finally {
      app.close();
    }
  });
  it("只选择文本生成且支持工具调用的模型", () => {
    expect(chooseModel(models)).toBe("text-tools");
    expect(() =>
      chooseModel({ data: [{ ...models.data[0], status: "Shutdown" }] }),
    ).toThrow("没有可用");
    expect(() =>
      chooseModel({
        data: [{ ...models.data[0], task_type: ["ImageGeneration"] }],
      }),
    ).toThrow("没有可用");
    expect(() =>
      chooseModel({ data: [{ ...models.data[0], features: {} }] }),
    ).toThrow("没有可用");
  });
});
