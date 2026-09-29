import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import {
  beginLogin,
  extractCode,
  OAuthProvider,
  type Credentials,
} from "../server/oauth";
import { ArkClient } from "../server/ark";

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let provider: OAuthProvider;
const credential = (): Credentials => ({
  accessKeyId: "private-ak",
  secretKey: "private-sk",
  sessionToken: "private-sts",
  refreshToken: "private-refresh",
  expiresAt: Date.now() + 900_000,
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "open-muse-auth-"));
  provider = new OAuthProvider();
  vi.spyOn(provider, "exchange").mockImplementation(async () => credential());
  vi.spyOn(provider, "projects").mockResolvedValue(["project-a"]);
  vi.spyOn(provider, "mintKey").mockImplementation(async (c, project) => {
    Object.assign(c, {
      project,
      apiKey: `private-api-${Math.random()}`,
      apiKeyId: "key-1",
    });
  });
  app = await createApp(loadConfig({ MUSE_DATA_DIR: dir }), {
    oauth: provider,
    arkFactory: (config) => {
      expect(config.project).toBe("project-a");
      const ark = new ArkClient(config);
      vi.spyOn(ark, "request").mockImplementation(async (path) =>
        path === "/models"
          ? {
              data: [
                {
                  id: "model-test",
                  task_type: ["TextGeneration"],
                  features: { tools: { function_calling: true } },
                },
              ],
            }
          : { id: "resource-id", status: "idle" },
      );
      return ark;
    },
  });
});
afterEach(async () => {
  app.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
async function login() {
  const begin = (
    await request(app.app).post("/api/auth/begin").send({}).expect(200)
  ).body;
  const state = new URL(begin.authorizeUrl).searchParams.get("state");
  const complete = await request(app.app)
    .post("/api/auth/complete")
    .send({ transaction: begin.transaction, code: `code=fake&state=${state}` })
    .expect(200);
  return { token: complete.body.sessionToken as string, begin };
}
async function ready(token: string) {
  await request(app.app)
    .post("/api/auth/project")
    .set("X-Muse-Session", token)
    .send({ project: "project-a", confirm: true })
    .expect(200);
}

describe("SSO 协议与隔离", () => {
  it("PKCE 使用随机 verifier、S256，且回调地址固定", () => {
    const login = beginLogin();
    const url = new URL(login.url);
    expect(url.origin).toBe("https://signin.volcengine.com");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(login.verifier).digest("base64url"),
    );
    expect(login.verifier).not.toBe(beginLogin().verifier);
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });
  it("裸授权码、带 state 查询和 base64 回调；拒绝其他站点与错误 state", () => {
    expect(extractCode("raw-code", "state")).toBe("raw-code");
    expect(
      extractCode(
        Buffer.from("code=valid&state=state").toString("base64"),
        "state",
      ),
    ).toBe("valid");
    expect(() => extractCode("code=value&state=forged", "state")).toThrow(
      "状态不匹配",
    );
    expect(() =>
      extractCode("https://evil.example/?code=x&state=state", "state"),
    ).toThrow("地址不正确");
    expect(() => extractCode("code=x", "state")).toThrow("状态不匹配");
  });
  it("同一登录事务只交换一次；verifier 不回传", async () => {
    const { begin } = await login();
    expect(JSON.stringify(begin)).not.toContain("verifier");
    await request(app.app)
      .post("/api/auth/complete")
      .send({ transaction: begin.transaction, code: "fake" })
      .expect(400);
    expect(provider.exchange).toHaveBeenCalledTimes(1);
  });
  it("错误 state 不兑换令牌，过期事务被拒绝", async () => {
    const begin = (await request(app.app).post("/api/auth/begin").send({}))
      .body;
    await request(app.app)
      .post("/api/auth/complete")
      .send({ transaction: begin.transaction, code: "code=fake&state=wrong" })
      .expect(400);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
    await request(app.app)
      .post("/api/auth/complete")
      .send({ transaction: begin.transaction, code: "fake" })
      .expect(400);
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("连接按钮确认创建密钥，重复连接同一项目不会再创建密钥", async () => {
    const { token } = await login();
    await request(app.app)
      .get("/api/sessions")
      .set("X-Muse-Session", token)
      .expect(409);
    await request(app.app)
      .post("/api/auth/project")
      .set("X-Muse-Session", token)
      .send({ project: "project-a" })
      .expect(400);
    await request(app.app)
      .post("/api/auth/project")
      .set("X-Muse-Session", token)
      .send({ project: "forbidden", confirm: true })
      .expect(403);
    expect(provider.mintKey).not.toHaveBeenCalled();
    await ready(token);
    await request(app.app)
      .post("/api/auth/project")
      .set("X-Muse-Session", token)
      .send({ project: "project-a", confirm: true })
      .expect(200);
    expect(provider.mintKey).toHaveBeenCalledTimes(1);
  });
  it("凭据加密保存、文件 0600，客户端状态不含 STS/API Key", async () => {
    const { token } = await login();
    await ready(token);
    const status = (
      await request(app.app)
        .get("/api/auth/status")
        .set("X-Muse-Session", token)
    ).body;
    expect(status).toMatchObject({ ready: true, project: "project-a" });
    expect(JSON.stringify(status)).not.toContain("private-");
    const disk = await readFile(join(dir, "auth.enc"));
    expect(disk.includes(Buffer.from("private-"))).toBe(false);
    expect((await stat(join(dir, "auth.enc"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "auth.key"))).mode & 0o777).toBe(0o600);
  });
  it("两个登录的工作空间独立；退出后不回退到另一账号", async () => {
    const a = await login();
    const b = await login();
    await ready(a.token);
    await request(app.app)
      .get("/api/workspace")
      .set("X-Muse-Session", b.token)
      .expect(409);
    await ready(b.token);
    const bSelection = (
      await request(app.app)
        .get("/api/workspace")
        .set("X-Muse-Session", b.token)
    ).body;
    expect(bSelection.state).toBe("ready");
    expect(bSelection).not.toHaveProperty("agent");
    await request(app.app)
      .post("/api/auth/logout")
      .set("X-Muse-Session", a.token)
      .send({})
      .expect(200);
    await request(app.app)
      .get("/api/sessions")
      .set("X-Muse-Session", a.token)
      .expect(401);
    expect(
      (await request(app.app).get("/api/config").set("X-Muse-Session", b.token))
        .body.mode,
    ).toBe("ark");
    expect((await request(app.app).get("/api/config")).body.mode).toBe("demo");
  });
  it("重启后可恢复登录；无效会话不降级到默认凭据", async () => {
    const { token } = await login();
    await ready(token);
    app.close();
    app = await createApp(loadConfig({ MUSE_DATA_DIR: dir }), {
      oauth: provider,
    });
    await request(app.app)
      .get("/api/auth/status")
      .set("X-Muse-Session", token)
      .expect(200);
    await request(app.app)
      .get("/api/config")
      .set("X-Muse-Session", "forged")
      .expect(401);
  });
  it("请求必须为 JSON；SSO 也受访问令牌和 Origin 保护", async () => {
    await request(app.app)
      .post("/api/auth/begin")
      .type("form")
      .send({})
      .expect(415);
    await request(app.app)
      .post("/api/auth/begin")
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
  });
});

describe("火山 OAuth 适配器", () => {
  it("兑换时使用表单、PKCE，错误不会泄露上游内容", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        access_token: JSON.stringify({
          data: {
            access_key_id: "ak",
            secret_access_key: "sk",
            session_token: "sts",
          },
        }),
        refresh_token: "refresh",
        expires_in: 900,
      }),
    );
    const provider = new OAuthProvider(fetcher);
    const result = await provider.exchange("code", "verifier");
    expect(result.accessKeyId).toBe("ak");
    expect(fetcher.mock.calls[0][1].body.get("code_verifier")).toBe("verifier");
    fetcher.mockResolvedValue(
      Response.json({ error: "private-credential" }, { status: 400 }),
    );
    await expect(provider.exchange("code", "v")).rejects.not.toThrow(
      "private-credential",
    );
  });
  it("TOP 请求使用官方签名；敏感凭据不在 URL", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ Result: { Items: [] } }));
    await new OAuthProvider(fetcher).action(credential(), "ListAgents", {
      ProjectName: "project-a",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://open.volcengineapi.com/?Action=ListAgents&Version=2024-01-01",
    );
    expect(init.headers.Authorization).toMatch(/^HMAC-SHA256/);
    expect(init.headers["X-Security-Token"]).toBe("private-sts");
    expect(init.redirect).toBe("error");
  });
  it("过期 STS 自动刷新并保留刷新令牌轮换", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        access_token: JSON.stringify({
          access_key_id: "fresh-ak",
          secret_access_key: "fresh-sk",
          session_token: "fresh-sts",
        }),
        refresh_token: "rotated",
      }),
    );
    const c = credential();
    c.expiresAt = 0;
    await new OAuthProvider(fetcher).refresh(c);
    expect(c.refreshToken).toBe("rotated");
    expect(c.accessKeyId).toBe("fresh-ak");
    expect(fetcher.mock.calls[0][1].body.get("grant_type")).toBe(
      "refresh_token",
    );
  });
});
