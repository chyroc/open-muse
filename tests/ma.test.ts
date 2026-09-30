import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./legacy-server/app";
import { loadConfig } from "./legacy-server/config";
import { ArkClient } from "./legacy-server/ark";
import { buildRequest, redactSecrets } from "./legacy-server/ma";
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

describe("Full MA interface mapping", () => {
  it("covers 49 MA capabilities and 3 file APIs and forbids inner/admin operations", async () => {
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
    it(`${op.id} uses the contract method/path and field positions`, async () => {
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
  it("does not allow path traversal, injecting unknown headers into fields, or arbitrary URLs", async () => {
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
  it("requires confirmation for write operations and a version for agent updates", async () => {
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
  it("array queries keep repeated parameters and cursors are safely encoded", () => {
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
  it("uploads skills only as ZIP, converting them to multipart files", async () => {
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
  it("file uploads support multipart and TOS fields; the API key is added by ArkClient", async () => {
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
  it("TOP-only operations require SSO; an API key never masquerades as STS", async () => {
    await request(app.app)
      .post("/api/ma/execute/ListOAuthProviders")
      .send({})
      .expect(401);
  });
  it("after importing sessions from the Ark list they can continue in task details; arbitrary sessions are never auto-exposed", async () => {
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
  it("reading the workspace creates no resources and removes the manual ID entry", async () => {
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
  it("redacts credential payloads a second time while keeping the notes body unchanged", () => {
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
