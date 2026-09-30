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
import {
  environmentWithTools,
  systemWithTools,
  type EnvironmentConfig,
} from "../server/tooling";

let dir: string;
let workspaces: Workspaces;
let runtime: Runtime;
type TestResource = {
  id: string;
  name: string;
  metadata: object;
  version?: number;
  system?: string;
  config?: EnvironmentConfig;
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
        if (collection === "agents" && body.version !== item.version)
          throw new ApiError(409, "version conflict");
        Object.assign(
          item,
          body,
          collection === "agents" ? { version: body.version + 1 } : {},
        );
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

describe("Automatic workspace and SQLite mapping", () => {
  it("auto-creates without IDs, adopting the cloud environment and approval policy; never returns IDs/keys to ordinary clients", async () => {
    expect(workspaces.status(runtime).state).toBe("idle");
    expect(runtime.ark.request).not.toHaveBeenCalled();
    const status = await prepare();
    expect(status.state).toBe("ready");
    expect(workspaces.selection(runtime)).toEqual({
      agent: "agents-1",
      environment_id: "environments-1",
    });
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[0][1]?.body)).config).toEqual(
      environmentWithTools({
        type: "cloud",
        networking: { type: "unrestricted" },
      }),
    );
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
  it("reuses the SQLite mapping after restart so repeated prepare does not recreate", async () => {
    await prepare();
    workspaces.close();
    workspaces = new Workspaces(dir);
    expect(workspaces.status(runtime).state).toBe("ready");
    await prepare();
    expect(posts()).toHaveLength(2);
  });
  it("updates permissions and the default prompt for existing assistants by version, keeping tool config and never creating new resources", async () => {
    await prepare();
    const agent = resources.agents[0];
    agent.tools![0].default_config.permission_policy.type = "always_ask";
    agent.system =
      "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. External writes, sending messages, transactions, and deletions require explicit confirmation; never describe unexecuted operations as completed.";
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
    expect(agent.system).toContain(
      "without asking for additional tool permission confirmation",
    );
    expect(JSON.parse(String(posts()[2][1]?.body))).toEqual({
      version: 1,
      tools: agent.tools,
      system: agent.system,
    });
    await prepare();
    expect(posts()).toHaveLength(3);
  });
  it("does not overwrite a custom prompt, a default-deny policy, or external resources", async () => {
    await prepare();
    const agent = resources.agents[0];
    agent.system = "custom system";
    agent.tools![0].default_config.permission_policy.type = "always_deny";
    await workspaces.syncToolPolicy(runtime);
    expect(posts()).toHaveLength(3);
    agent.metadata = {};
    agent.tools![0].default_config.permission_policy.type = "always_ask";
    await workspaces.syncToolPolicy(runtime);
    expect(posts()).toHaveLength(3);
    expect(agent.system).toBe(systemWithTools("custom system"));
  });
  it("does not update without a valid version; a permission-sync failure never creates a replacement resource", async () => {
    await prepare();
    resources.agents[0].version = undefined;
    resources.agents[0].tools![0].default_config.permission_policy.type =
      "always_ask";
    expect((await prepare()).state).toBe("error");
    expect(posts()).toHaveLength(2);
    expect(resources.agents).toHaveLength(1);
  });
  it("concurrent prepares on the same connection merge into a single job", async () => {
    await Promise.all(Array.from({ length: 8 }, () => prepare()));
    expect(posts()).toHaveLength(2);
    expect(workspaces.status(runtime).state).toBe("ready");
  });
  it("upgrades an existing environment in place and adds the guide once", async () => {
    await prepare();
    const environment = resources.environments[0];
    environment.config = {
      type: "cloud",
      networking: { type: "limited" },
      env: { CUSTOM: "keep" },
      packages: { apt: ["git=custom"], npm: ["custom-package"] },
      setup_script: "echo custom",
    };
    resources.agents[0].system = "Custom instructions";
    await workspaces.syncToolPolicy(runtime);
    expect(resources.environments).toHaveLength(1);
    expect(resources.agents).toHaveLength(1);
    expect(
      posts()
        .slice(2)
        .map(([path]) => path),
    ).toEqual(["/environments/environments-1", "/agents/agents-1"]);
    expect(environment.config.networking).toEqual({ type: "limited" });
    expect(environment.config.env).toEqual({ CUSTOM: "keep" });
    expect(environment.config.packages?.npm).toEqual(["custom-package"]);
    expect(environment.config.setup_script).toContain("echo custom");
    expect(resources.agents[0].system).toBe(
      systemWithTools("Custom instructions"),
    );
    await workspaces.syncToolPolicy(runtime);
    expect(posts()).toHaveLength(4);
  });
  it("does not provision external or self-hosted environments", async () => {
    await prepare();
    for (const external of [true, false]) {
      const environment = resources.environments[0];
      environment.config = { type: external ? "cloud" : "self_hosted" };
      environment.metadata = external
        ? {}
        : { open_muse_workspace: workspaceKey(runtime) };
      resources.agents[0].system = "Custom instructions";
      await workspaces.syncToolPolicy(runtime);
      expect(posts()).toHaveLength(2);
      expect(environment.config.setup_script).toBeUndefined();
      expect(resources.agents[0].system).toBe("Custom instructions");
    }
  });
  it("stops on environment update failure without replacing resources or changing the prompt", async () => {
    await prepare();
    resources.environments[0].config = { type: "cloud" };
    resources.agents[0].system = "Custom instructions";
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/environments/environments-1" && init?.method === "POST")
        throw new ApiError(403, "Update denied");
      return original(path, init);
    });
    await expect(workspaces.syncToolPolicy(runtime)).rejects.toThrow(
      "Update denied",
    );
    expect(resources.agents[0].system).toBe("Custom instructions");
    expect(resources.environments).toHaveLength(1);
    expect(resources.agents).toHaveLength(1);
    expect(posts()).toHaveLength(3);
    vi.mocked(runtime.ark.request).mockImplementation(original);
    await workspaces.syncToolPolicy(runtime);
    expect(resources.agents[0].system).toBe(
      systemWithTools("Custom instructions"),
    );
  });
  it("isolates upstream URL, key, and project separately; SQLite stores only a digest", async () => {
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
  it("keeps the created environment on partial failure; recovery creates only the missing assistant", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    let denied = true;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/agents" && denied) {
        denied = false;
        throw new ApiError(403, "Permission denied");
      }
      return original(path, init);
    });
    expect((await prepare()).state).toBe("error");
    expect(resources.environments).toHaveLength(1);
    expect((await prepare()).state).toBe("ready");
    expect(resources.environments).toHaveLength(1);
    expect(resources.agents).toHaveLength(1);
  });
  it("when the cloud succeeds but the response is lost, recovers by marker after restart without duplicate POSTs", async () => {
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
  it("does not blindly recreate when the result is unknown and not found in the list, and never claims an external resource of the same name", async () => {
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
    expect((await prepare()).message).toContain("will not be recreated");
    expect(posts()).toHaveLength(1);
  });
  it("only recreates after an explicit 404; 403 and 502 do not trigger recreation", async () => {
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
  it("migrates old default configuration into SQLite without creating replacement resources", async () => {
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
  it("creates no resources when no model is available; an admin can configure a model without supplying a resource ID", async () => {
    vi.mocked(runtime.ark.request).mockResolvedValueOnce({ data: [] });
    expect((await prepare()).message).toContain("No tool-calling model");
    expect(posts()).toHaveLength(0);
    runtime.config.modelId = "configured-model";
    expect((await prepare()).state).toBe("ready");
    expect(JSON.parse(String(posts()[1][1]?.body)).model.id).toBe(
      "configured-model",
    );
  });
  it("does not continue creating subsequent resources after cancellation", async () => {
    const original = vi.mocked(runtime.ark.request).getMockImplementation()!;
    vi.mocked(runtime.ark.request).mockImplementation(async (path, init) => {
      if (path === "/environments") workspaces.cancel(runtime);
      return original(path, init);
    });
    expect((await prepare()).state).toBe("error");
    expect(posts()).toHaveLength(1);
    expect(resources.agents).toHaveLength(0);
  });
  it("the public flow only needs prepare; the server fills in the mapping when a task is created", async () => {
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
  it("only selects text-generation models that support tool calling", () => {
    expect(chooseModel(models)).toBe("text-tools");
    expect(() =>
      chooseModel({ data: [{ ...models.data[0], status: "Shutdown" }] }),
    ).toThrow("No tool-calling model");
    expect(() =>
      chooseModel({
        data: [{ ...models.data[0], task_type: ["ImageGeneration"] }],
      }),
    ).toThrow("No tool-calling model");
    expect(() =>
      chooseModel({ data: [{ ...models.data[0], features: {} }] }),
    ).toThrow("No tool-calling model");
  });
});
