import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig, type ServerConfig } from "../server/config";
import { ApiError, ArkClient } from "../server/ark";
import { operations } from "../shared/ma";

const key = "test-only-api-key-not-a-real-secret";
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
let rejectKey = false;
let calls: { path: string; config: ServerConfig }[];
const arkFactory = (config: ServerConfig) => {
  const ark = new ArkClient(config);
  vi.spyOn(ark, "request").mockImplementation(async (path) => {
    calls.push({ path, config });
    if (rejectKey) throw new ApiError(401, "Ark rejected this key.");
    return { data: [] } as never;
  });
  return ark;
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-muse-key-auth-"));
  calls = [];
  rejectKey = false;
  app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }), {
    arkFactory,
  });
});
afterEach(async () => {
  app.close();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
async function login(apiKey = key, project = "") {
  const response = await request(app.app)
    .post("/api/auth/api-key")
    .send({ apiKey, project, confirm: true })
    .expect(200);
  expect(response.text).not.toContain(apiKey);
  return response.body.sessionToken as string;
}

describe("Manual API key login", () => {
  it("verifies the key read-only first, then returns an app session; it never creates a new key or secretly creates cloud resources", async () => {
    const token = await login();
    expect(calls.map((c) => c.path)).toEqual(["/models"]);
    expect(calls[0].config.arkBaseUrl).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
    expect(calls[0].config.arkKey).toBe(key);
    const status = await request(app.app)
      .get("/api/auth/status")
      .set("X-Muse-Session", token)
      .expect(200);
    expect(status.body).toMatchObject({
      loggedIn: true,
      ready: true,
      method: "api_key",
    });
    expect(status.text).not.toContain(key);
    expect(
      (await request(app.app).get("/api/config").set("X-Muse-Session", token))
        .body.mode,
    ).toBe("ark");
  });
  it("stores the key encrypted; after logout the old session is invalid and the user's key is not revoked", async () => {
    const token = await login();
    expect(
      (await readFile(join(directory, "auth.enc"))).includes(Buffer.from(key)),
    ).toBe(false);
    expect((await stat(join(directory, "auth.enc"))).mode & 0o777).toBe(0o600);
    await request(app.app)
      .post("/api/auth/logout")
      .set("X-Muse-Session", token)
      .send({})
      .expect(200);
    await request(app.app)
      .get("/api/goals")
      .set("X-Muse-Session", token)
      .expect(401);
    expect(calls.map((c) => c.path)).toEqual(["/models"]);
  });
  it("rejects an invalid key and does not persist the failed key", async () => {
    rejectKey = true;
    await request(app.app)
      .post("/api/auth/api-key")
      .send({ apiKey: key, confirm: true })
      .expect(401);
    await expect(readFile(join(directory, "auth.enc"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects missing confirmation, header injection, and a self-selected upstream, avoiding accidental key disclosure", async () => {
    for (const body of [
      { apiKey: key },
      { apiKey: `${key}\r\nInjected: yes`, confirm: true },
      { apiKey: key, project: "a\nb", confirm: true },
      { apiKey: key, baseUrl: "https://evil.example", confirm: true },
    ])
      await request(app.app).post("/api/auth/api-key").send(body).expect(400);
    expect(calls).toHaveLength(0);
  });
  it("uses the project only as an upstream request header and never passes the API key off as STS", async () => {
    const token = await login(key, "project-a");
    expect(calls[0].config.project).toBe("project-a");
    await request(app.app)
      .get("/api/auth/projects")
      .set("X-Muse-Session", token)
      .expect(403);
    await request(app.app)
      .post("/api/auth/project")
      .set("X-Muse-Session", token)
      .send({ project: "other", confirm: true })
      .expect(403);
    const op = operations.find(
      (o) => o.transport === "top" && o.id.startsWith("List"),
    )!;
    const body = Object.fromEntries(
      op.fields
        .filter((f) => f.in === "body" && f.required)
        .map((f) => [f.name, "test"]),
    );
    await request(app.app)
      .post(`/api/ma/execute/${op.id}`)
      .set("X-Muse-Session", token)
      .send({ body })
      .expect(401);
    expect(calls.map((c) => c.path)).toEqual(["/models"]);
  });
  it("isolates storage by key and project, while repeated logins of the same identity share consistent storage", async () => {
    const a = await login();
    const a2 = await login();
    const b = await login("test-only-second-api-key-identity");
    const p = await login(key, "different-project");
    await Promise.all(
      [a, a2].map((token, i) =>
        request(app.app)
          .post("/api/goals")
          .set("X-Muse-Session", token)
          .send({ title: `Goal ${i}` })
          .expect(201),
      ),
    );
    for (const token of [a, a2])
      expect(
        (await request(app.app).get("/api/goals").set("X-Muse-Session", token))
          .body.data,
      ).toHaveLength(2);
    for (const token of [b, p])
      expect(
        (await request(app.app).get("/api/goals").set("X-Muse-Session", token))
          .body.data,
      ).toEqual([]);
  });
  it("restores goals after a server restart or a fresh login with the same key", async () => {
    const token = await login();
    await request(app.app)
      .post("/api/goals")
      .set("X-Muse-Session", token)
      .send({ title: "Persisted goal" })
      .expect(201);
    app.close();
    app = await createApp(loadConfig({ MUSE_DATA_DIR: directory }), {
      arkFactory,
    });
    for (const t of [token, await login()])
      expect(
        (await request(app.app).get("/api/goals").set("X-Muse-Session", t)).body
          .data[0].title,
      ).toBe("Persisted goal");
  });
  it("does not let an existing session overwrite identity; login stays protected by Origin and the application access token", async () => {
    const token = await login();
    await request(app.app)
      .post("/api/auth/api-key")
      .set("X-Muse-Session", token)
      .send({ apiKey: key, confirm: true })
      .expect(409);
    await request(app.app)
      .post("/api/auth/api-key")
      .set("Origin", "https://evil.example")
      .send({ apiKey: key, confirm: true })
      .expect(403);
    app.close();
    app = await createApp(
      loadConfig({
        MUSE_DATA_DIR: directory,
        MUSE_ACCESS_TOKEN: "application-access-test-token",
      }),
      { arkFactory },
    );
    await request(app.app)
      .post("/api/auth/api-key")
      .send({ apiKey: key, confirm: true })
      .expect(401);
  });
});
