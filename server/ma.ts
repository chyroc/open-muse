import { Router } from "express";
import { z } from "zod";
import { operations, type MAOperation } from "../shared/ma";
import { ApiError, ArkClient } from "./ark";
import type { AuthStore } from "./auth";
import { isSSOCredentials, type LoginCredentials } from "./oauth";
import type { Store } from "./store";
import type { ServerConfig } from "./config";

export interface Runtime {
  config: ServerConfig;
  ark: ArkClient;
  store: Store;
  credentials?: LoginCredentials;
  streams?: Set<AbortController>;
}
const record = z.record(z.string(), z.unknown());
const inputSchema = z.object({
  params: z.record(z.string(), z.string().max(200)).default({}),
  query: record.default({}),
  body: record.default({}),
  confirm: z.boolean().optional(),
  file: z
    .object({
      name: z.string().min(1).max(255),
      base64: z.string().max(14_000_000),
    })
    .optional(),
});
export function buildRequest(
  op: MAOperation,
  input: z.infer<typeof inputSchema>,
) {
  let path = op.path.replace(/:([a-z_]+)/g, (_match, key: string) => {
    const value = input.params[key];
    if (!value || !/^[\w-]+$/.test(value))
      throw new ApiError(400, `请填写有效的 ${key}。`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query)) {
    if (!op.fields.some((f) => f.in === "query" && f.name === key))
      throw new ApiError(400, `不支持查询字段 ${key}。`);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!["string", "number", "boolean"].includes(typeof item))
        throw new ApiError(400, "查询参数须为基本类型或数组。");
      query.append(key, String(item));
    }
  }
  if (query.size) path += `?${query}`;
  const allowed = op.fields.filter((f) => ["body", "form"].includes(f.in));
  for (const key of Object.keys(input.body))
    if (!allowed.some((f) => f.name === key))
      throw new ApiError(400, `不支持请求字段 ${key}。`);
  for (const field of allowed)
    if (field.required && input.body[field.name] === undefined)
      throw new ApiError(400, `缺少 ${field.name}。`);
  return path;
}
export function maRouter(auth: AuthStore) {
  const router = Router();
  router.get("/capabilities", (_req, res) =>
    res.json({
      operations,
      source: "Managed Agents",
      internalAPIsExposed: false,
    }),
  );
  router.post("/execute/:operation", async (req, res) => {
    const op = operations.find((o) => o.id === req.params.operation);
    if (!op) throw new ApiError(404, "未注册的 MA 操作；不允许任意代理请求。");
    const runtime = res.locals.runtime as Runtime;
    if (runtime.config.mode !== "ark")
      throw new ApiError(
        409,
        "工作台需要真实方舟连接。演示模式不会伪造 MA 资源。",
      );
    const input = inputSchema.parse(req.body);
    if (op.method !== "GET" && !op.id.startsWith("List") && !input.confirm)
      throw new ApiError(400, "此操作会修改云端资源，请确认操作对象与影响。");
    const path = buildRequest(op, input);
    if (op.id === "StreamSessionEvents")
      throw new ApiError(400, "实时事件流请从任务详情查看，工作台只查询历史。");
    let result: unknown;
    if (op.transport === "top") {
      const credentials = runtime.credentials;
      if (!credentials || !isSSOCredentials(credentials))
        throw new ApiError(401, "此控制面接口需要 SSO 登录提供 STS 凭据。");
      try {
        result = await auth.serialized(req.get("X-Muse-Session") ?? "", () =>
          auth.provider.action(credentials, op.id, {
            ...input.body,
            ...(op.fields.some((f) => f.name === "ProjectName")
              ? { ProjectName: credentials.project }
              : {}),
          }),
        );
      } finally {
        await auth.save();
      }
    } else if (["CreateSkill", "UploadFile"].includes(op.id)) {
      const form = new FormData();
      for (const [key, value] of Object.entries(input.body))
        if (value !== undefined) {
          if (key === "tos" && value && typeof value === "object") {
            for (const [name, item] of Object.entries(value)) {
              if (
                !["bucket", "prefix"].includes(name) ||
                typeof item !== "string"
              )
                throw new ApiError(400, "tos 仅支持 bucket 与 prefix 字符串。");
              form.append(`tos.${name}`, item);
            }
          } else
            form.append(
              key,
              typeof value === "object" ? JSON.stringify(value) : String(value),
            );
        }
      if (input.file) {
        if (/[\\/\r\n]/.test(input.file.name))
          throw new ApiError(400, "文件名不允许包含路径。");
        const bytes = Buffer.from(input.file.base64, "base64");
        if (bytes.length > 10 * 1024 * 1024)
          throw new ApiError(413, "文件最大为 10 MB。");
        if (
          op.id === "CreateSkill" &&
          (!input.file.name.endsWith(".zip") ||
            bytes.subarray(0, 2).toString() !== "PK")
        )
          throw new ApiError(400, "MA 技能接口只接受 ZIP 文件。");
        form.append(
          op.id === "CreateSkill" ? "files" : "file",
          new Blob([bytes], {
            type:
              op.id === "CreateSkill"
                ? "application/zip"
                : "application/octet-stream",
          }),
          input.file.name,
        );
      } else if (op.id === "CreateSkill" || !input.body.url)
        throw new ApiError(400, "请先选择上传文件。");
      result = await runtime.ark.request(path, { method: "POST", body: form });
    } else {
      result = await runtime.ark.request(path, {
        method: op.method,
        ...(op.id === "GetFile"
          ? { headers: { "X-Ark-PreSignedURL-ExpiresAfter": "86400" } }
          : {}),
        ...(op.method === "POST" ? { body: JSON.stringify(input.body) } : {}),
      });
    }
    // 创建/导入会话后，让任务页可继续对话；租户授权始终由当前上游凭据决定。
    if (["CreateSession", "GetSession", "ListSessions"].includes(op.id)) {
      const payload = result as {
        data?: import("../shared/types").Session[];
      } & import("../shared/types").Session;
      for (const session of payload.data ?? [payload])
        if (session.id) {
          const old = runtime.store.get(session.id);
          const value = {
            ...session,
            title: session.title || "未命名任务",
            category: old?.category ?? ("general" as const),
          };
          if (old) Object.assign(old, value);
          else runtime.store.data.sessions.push(value);
        }
      await runtime.store.save();
    }
    if (op.id === "DeleteSession") {
      runtime.store.data.sessions = runtime.store.data.sessions.filter(
        (s) => s.id !== input.params.session_id,
      );
      await runtime.store.save();
    }
    // 凭据验证接口的原始 HTTP body 可能带刷新后的令牌，不交给客户端展示。
    if (
      op.id === "ValidateCredential" &&
      result &&
      typeof result === "object"
    ) {
      const maskBodies = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(maskBodies)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([key, item]) => [
                  key,
                  key.toLowerCase() === "body"
                    ? "[upstream body omitted]"
                    : maskBodies(item),
                ]),
              )
            : value;
      result = maskBodies(result);
    }
    res.json(redactSecrets(result));
  });
  return router;
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /^(access_?token|refresh_?token|session_?token|api_?key|raw_?api_?key|secret_?value|client_?secret|secret_?access_?key|authorization|token)$/i.test(
        key,
      )
        ? "[redacted]"
        : redactSecrets(item),
    ]),
  );
}
