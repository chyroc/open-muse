import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { ArkClient } from "../server/ark";
import { buildRequest, redactSecrets } from "../server/ma";
import { operations } from "../shared/ma";
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
let ark: ArkClient;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-muse-ma-"));
  const config = loadConfig({
    MUSE_MODE: "ark",
    ARK_API_KEY: "private-api",
    MUSE_DATA_DIR: directory,
  });
  ark = new ArkClient(config);
  vi.spyOn(ark, "request").mockResolvedValue({ data: [] });
  app = await createApp(config, { ark });
});
afterEach(async () => {
  app.close();
  await rm(directory, { recursive: true, force: true });
});

describe("MA 完整接口映射", () => {
  it("覆盖 49 项 MA 能力与 3 项文件 API，禁止 inner/admin 操作", async () => {
    const result = await request(app.app)
      .get("/api/ma/capabilities")
      .expect(200);
    expect(result.body.operations).toHaveLength(52);
    expect(new Set(operations.map((o) => o.id)).size).toBe(52);
    expect(
      operations
        .flatMap((operation) => operation.fields)
        .every((field) =>
          [
            "string",
            "integer",
            "boolean",
            "array",
            "object",
            "string | object",
          ].includes(field.type),
        ),
    ).toBe(true);
    expect(operations.some((o) => o.path.includes("inner"))).toBe(false);
    await request(app.app)
      .post("/api/ma/execute/UnregisteredOperation")
      .send({})
      .expect(404);
  });
  for (const op of operations.filter(
    (o) =>
      o.transport === "rest" &&
      !["UploadFile", "CreateSkill", "StreamSessionEvents"].includes(o.id),
  )) {
    it(`${op.id} 使用契约中的 method/path 和字段位置`, async () => {
      const params = Object.fromEntries(
        op.fields
          .filter((f) => f.in === "path")
          .map((f) => [f.name, "resource-123"]),
      );
      const body = Object.fromEntries(
        op.fields
          .filter((f) => f.in === "body" && f.required)
          .map((f) => [
            f.name,
            f.type === "array" ? [] : f.type === "integer" ? 1 : "test",
          ]),
      );
      const query = op.fields.some((f) => f.name === "page" && f.in === "query")
        ? { page: "opaque+/=" }
        : {};
      const expected = buildRequest(op, { params, query, body, confirm: true });
      await request(app.app)
        .post(`/api/ma/execute/${op.id}`)
        .send({ params, body, query, confirm: true })
        .expect(200);
      expect(ark.request).toHaveBeenCalledWith(expected, {
        method: op.method,
        ...(op.id === "GetFile"
          ? { headers: { "X-Ark-PreSignedURL-ExpiresAfter": "86400" } }
          : {}),
        ...(op.method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    });
  }
  it("路径不能穿越、字段不能注入未知头部或任意 URL", async () => {
    for (const id of ["../agents", "http://evil.example", "%2e%2e", "id?x=1"]) {
      await request(app.app)
        .post("/api/ma/execute/GetAgent")
        .send({ params: { id } })
        .expect(400);
    }
    await request(app.app)
      .post("/api/ma/execute/ListAgents")
      .send({ query: { Authorization: "secret" } })
      .expect(400);
    await request(app.app)
      .post("/api/ma/execute/CreateAgent")
      .send({
        body: { name: "a", model: { id: "ep-test" }, AccountId: "foreign" },
        confirm: true,
      })
      .expect(400);
    expect(ark.request).not.toHaveBeenCalled();
  });
  it("写操作要求确认，Agent 更新必须带版本", async () => {
    await request(app.app)
      .post("/api/ma/execute/DeleteAgent")
      .send({ params: { id: "agent-1" } })
      .expect(400);
    await request(app.app)
      .post("/api/ma/execute/UpdateAgent")
      .send({
        params: { id: "agent-1" },
        body: { name: "updated" },
        confirm: true,
      })
      .expect(400);
    expect(ark.request).not.toHaveBeenCalled();
  });
  it("数组查询保留重复参数，游标安全编码", () => {
    const path = buildRequest(
      operations.find((o) => o.id === "ListSessions")!,
      {
        params: {},
        body: {},
        query: { status: ["running", "idle"], page: "a+/=" },
      },
    );
    expect(path).toBe("/sessions?status=running&status=idle&page=a%2B%2F%3D");
  });
  it("技能只上传 ZIP，转换为 multipart files", async () => {
    await request(app.app)
      .post("/api/ma/execute/CreateSkill")
      .send({
        body: { display_title: "test" },
        confirm: true,
        file: { name: "SKILL.md", base64: Buffer.from("x").toString("base64") },
      })
      .expect(400);
    await request(app.app)
      .post("/api/ma/execute/CreateSkill")
      .send({
        body: { display_title: "test" },
        confirm: true,
        file: {
          name: "skill.zip",
          base64: Buffer.from("PK-fixture").toString("base64"),
        },
      })
      .expect(200);
    const form = vi.mocked(ark.request).mock.calls[0][1]?.body as FormData;
    expect(form.get("display_title")).toBe("test");
    expect((form.get("files") as File).name).toBe("skill.zip");
  });
  it("文件上传支持 multipart 与 TOS 字段，API Key 由 ArkClient 添加", async () => {
    await request(app.app)
      .post("/api/ma/execute/UploadFile")
      .send({
        body: {
          purpose: "agent",
          tos: { bucket: "test-bucket", prefix: "files/" },
        },
        confirm: true,
        file: {
          name: "notes.md",
          base64: Buffer.from("notes").toString("base64"),
        },
      })
      .expect(200);
    const form = vi.mocked(ark.request).mock.calls[0][1]?.body as FormData;
    expect(form.get("tos.bucket")).toBe("test-bucket");
    expect((form.get("file") as File).name).toBe("notes.md");
  });
  it("TOP 独有操作需要 SSO，API Key 不冒充 STS", async () => {
    await request(app.app)
      .post("/api/ma/execute/ListOAuthProviders")
      .send({})
      .expect(401);
  });
  it("从方舟列表导入会话后，可在任务详情继续；不自动暴露任意会话", async () => {
    vi.mocked(ark.request).mockResolvedValue({
      data: [
        {
          id: "sesn-cloud",
          title: "existing",
          status: "idle",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    await request(app.app)
      .post("/api/ma/execute/ListSessions")
      .send({})
      .expect(200);
    expect(app.store.get("sesn-cloud")?.category).toBe("general");
    await request(app.app).get("/api/sessions/unknown").expect(404);
  });
  it("读取工作空间不创建资源，移除用户手动填写 ID 的入口", async () => {
    expect((await request(app.app).get("/api/workspace")).body.state).toBe(
      "idle",
    );
    expect(ark.request).not.toHaveBeenCalled();
    await request(app.app)
      .post("/api/sessions")
      .send({ title: "test" })
      .expect(409);
    await request(app.app)
      .post("/api/ma/selection")
      .send({ agent: "agent-x", environment_id: "env-x" })
      .expect(404);
    expect(app.store.data.selection).toBeUndefined();
  });
  it("凭据回包二次脱敏，记忆正文保持不变", () => {
    expect(
      redactSecrets({
        auth: {
          token: "sensitive",
          refresh: { refresh_token: "secret", client_secret: "secret" },
        },
        content: "my notes",
      }),
    ).toEqual({
      auth: {
        token: "[redacted]",
        refresh: { refresh_token: "[redacted]", client_secret: "[redacted]" },
      },
      content: "my notes",
    });
  });
});
