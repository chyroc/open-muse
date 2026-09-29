import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { ApiError } from "./ark";
import {
  beginLogin,
  extractCode,
  OAuthProvider,
  isSSOCredentials,
  type LoginCredentials,
  type APIKeyCredentials,
} from "./oauth";

interface Identity {
  credentials: LoginCredentials;
  expiresAt: number;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class AuthStore {
  private key!: Buffer;
  private identities: Record<string, Identity> = {};
  private pending = new Map<
    string,
    ReturnType<typeof beginLogin> & { expiresAt: number }
  >();
  private queue: Promise<void> = Promise.resolve();
  private locks = new Set<string>();
  private keyLogins = 0;
  constructor(
    private directory: string,
    public provider = new OAuthProvider(),
  ) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const keyPath = join(this.directory, "auth.key");
    try {
      this.key = await readFile(keyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.key = randomBytes(32);
      await writeFile(keyPath, this.key, { mode: 0o600, flag: "wx" });
    }
    try {
      const data = await readFile(join(this.directory, "auth.enc"));
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        data.subarray(0, 12),
      );
      decipher.setAuthTag(data.subarray(12, 28));
      this.identities = JSON.parse(
        Buffer.concat([
          decipher.update(data.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const [id, value] of Object.entries(this.identities))
      if (value.expiresAt < Date.now()) delete this.identities[id];
  }
  save() {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(this.identities)),
      cipher.final(),
    ]);
    const data = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    const target = join(this.directory, "auth.enc");
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await writeFile(`${target}.tmp`, data, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
      });
    this.queue = next;
    return next;
  }
  get(token?: string) {
    if (!token) return undefined;
    const identity = this.identities[digest(token)];
    if (!identity || identity.expiresAt < Date.now())
      throw new ApiError(
        401,
        "登录已过期，请重新登录；不会自动切换到其他账户。",
      );
    return identity.credentials;
  }
  async serialized<T>(token: string, action: () => Promise<T>) {
    if (this.locks.has(token))
      throw new ApiError(409, "登录操作正在处理，请稍后再试。");
    this.locks.add(token);
    try {
      return await action();
    } finally {
      this.locks.delete(token);
    }
  }
  router(
    onLogout: (token: string) => void,
    onConnected: (token: string) => Promise<void> = async () => {},
    validateAPIKey?: (credentials: APIKeyCredentials) => Promise<void>,
  ) {
    const router = Router();
    router.post("/api-key", async (req, res) => {
      if (!validateAPIKey)
        throw new ApiError(503, "当前服务未启用 API Key 登录。");
      if (req.get("X-Muse-Session"))
        throw new ApiError(409, "请先退出当前登录，再连接其他凭据。");
      const input = z
        .object({
          apiKey: z
            .string()
            .trim()
            .min(16)
            .max(1024)
            .regex(/^[\x21-\x7e]+$/),
          project: z
            .string()
            .trim()
            .max(128)
            .regex(/^[^\r\n]*$/)
            .default(""),
          confirm: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (this.keyLogins >= 5)
        throw new ApiError(429, "连接请求过多，请稍后重试。");
      this.keyLogins++;
      try {
        const credentials: APIKeyCredentials = {
          kind: "api_key",
          apiKey: input.apiKey,
          project: input.project,
        };
        // A read-only upstream request must succeed before saving any secret.
        await validateAPIKey(credentials);
        const token = randomBytes(32).toString("base64url");
        this.identities[digest(token)] = {
          credentials,
          expiresAt: Date.now() + 7 * 86400_000,
        };
        try {
          await this.save();
        } catch (error) {
          delete this.identities[digest(token)];
          throw error;
        }
        // Cloud provisioning starts separately after the client has received
        // its session, so a lost provisioning response cannot lose the login.
        res.json({ sessionToken: token });
      } finally {
        this.keyLogins--;
      }
    });
    router.post("/begin", (_req, res) => {
      for (const [id, value] of this.pending)
        if (value.expiresAt < Date.now()) this.pending.delete(id);
      if (this.pending.size >= 100)
        throw new ApiError(429, "登录请求过多，请稍后重试。");
      const login = beginLogin();
      const transaction = randomBytes(32).toString("base64url");
      this.pending.set(digest(transaction), {
        ...login,
        expiresAt: Date.now() + 600_000,
      });
      res.json({ transaction, authorizeUrl: login.url, expiresIn: 600 });
    });
    router.post("/complete", async (req, res) => {
      const input = z
        .object({
          transaction: z.string().max(100),
          code: z.string().min(1).max(8192),
        })
        .parse(req.body);
      const pending = this.pending.get(digest(input.transaction));
      if (!pending || pending.expiresAt < Date.now())
        throw new ApiError(400, "登录事务已过期或已使用，请重新开始。");
      const code = extractCode(input.code, pending.state);
      this.pending.delete(digest(input.transaction));
      const credentials = await this.provider.exchange(code, pending.verifier);
      const token = randomBytes(32).toString("base64url");
      this.identities[digest(token)] = {
        credentials,
        expiresAt: Date.now() + 7 * 86400_000,
      };
      await this.save();
      res.json({ sessionToken: token });
    });
    router.get("/status", (req, res) => {
      const c = this.get(req.get("X-Muse-Session"));
      res.json({
        loggedIn: Boolean(c),
        ready: Boolean(c?.apiKey),
        method: c ? (isSSOCredentials(c) ? "sso" : "api_key") : undefined,
        project: c?.project,
        apiKeyId: c && isSSOCredentials(c) ? c.apiKeyId : undefined,
      });
    });
    router.get("/projects", async (req, res) => {
      const token = req.get("X-Muse-Session") ?? "";
      const c = this.get(token);
      if (!c) throw new ApiError(401, "请先登录火山账号。");
      if (!isSSOCredentials(c))
        throw new ApiError(
          403,
          "项目列表需要 SSO 登录，API Key 无法提供 STS。",
        );
      let projects: string[];
      try {
        projects = await this.serialized(token, () =>
          this.provider.projects(c),
        );
      } finally {
        await this.save();
      }
      res.json({ projects });
    });
    router.post("/project", async (req, res) => {
      const token = req.get("X-Muse-Session") ?? "";
      const c = this.get(token);
      if (!c) throw new ApiError(401, "请先登录火山账号。");
      if (!isSSOCredentials(c))
        throw new ApiError(
          403,
          "项目授权需要 SSO 登录，API Key 无法提供 STS。",
        );
      const { project, confirm } = z
        .object({
          project: z.string().min(1).max(128),
          confirm: z.literal(true),
        })
        .parse(req.body);
      await this.serialized(token, async () => {
        if (c.apiKey && c.project !== project)
          throw new ApiError(409, "项目已连接。切换项目请退出后重新登录。");
        if (c.apiKeyId && c.project !== project)
          throw new ApiError(409, "已有待完成的 API Key，请继续原项目。");
        try {
          if (c.apiKey) return;
          if (!(await this.provider.projects(c)).includes(project))
            throw new ApiError(403, "无权访问所选项目。");
          if (confirm && c.apiKeyId) await this.provider.readKey(c);
          else await this.provider.mintKey(c, project);
        } finally {
          await this.save();
        }
      });
      await onConnected(token);
      res.json({ ready: true, project });
    });
    router.post("/logout", async (req, res) => {
      const token = req.get("X-Muse-Session") ?? "";
      await this.serialized(token, async () => {
        delete this.identities[digest(token)];
        await this.save();
      });
      onLogout(token);
      res.json({ ok: true });
    });
    return router;
  }
}
