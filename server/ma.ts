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
      throw new ApiError(400, `Please provide a valid ${key}.`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query)) {
    if (!op.fields.some((f) => f.in === "query" && f.name === key))
      throw new ApiError(400, `Unsupported query field ${key}.`);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!["string", "number", "boolean"].includes(typeof item))
        throw new ApiError(
          400,
          "Query parameters must be primitives or arrays.",
        );
      query.append(key, String(item));
    }
  }
  if (query.size) path += `?${query}`;
  const allowed = op.fields.filter((f) => ["body", "form"].includes(f.in));
  for (const key of Object.keys(input.body))
    if (!allowed.some((f) => f.name === key))
      throw new ApiError(400, `Unsupported request field ${key}.`);
  for (const field of allowed)
    if (field.required && input.body[field.name] === undefined)
      throw new ApiError(400, `Missing ${field.name}.`);
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
    if (!op)
      throw new ApiError(
        404,
        "Unregistered MA operation; arbitrary proxy requests are not allowed.",
      );
    const runtime = res.locals.runtime as Runtime;
    if (runtime.config.mode !== "ark")
      throw new ApiError(
        409,
        "The workbench requires a real Ark connection. Demo mode does not fabricate MA resources.",
      );
    const input = inputSchema.parse(req.body);
    if (op.method !== "GET" && !op.id.startsWith("List") && !input.confirm)
      throw new ApiError(
        400,
        "This operation modifies cloud resources; confirm the target and its impact.",
      );
    const path = buildRequest(op, input);
    if (op.id === "StreamSessionEvents")
      throw new ApiError(
        400,
        "View the real-time event stream from the task details; the workbench only queries history.",
      );
    let result: unknown;
    if (op.transport === "top") {
      const credentials = runtime.credentials;
      if (!credentials || !isSSOCredentials(credentials))
        throw new ApiError(
          401,
          "This control-plane API requires SSO login to provide STS credentials.",
        );
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
                throw new ApiError(
                  400,
                  "tos only supports the bucket and prefix strings.",
                );
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
          throw new ApiError(400, "File names must not contain paths.");
        const bytes = Buffer.from(input.file.base64, "base64");
        if (bytes.length > 10 * 1024 * 1024)
          throw new ApiError(413, "The file must be at most 10 MB.");
        if (
          op.id === "CreateSkill" &&
          (!input.file.name.endsWith(".zip") ||
            bytes.subarray(0, 2).toString() !== "PK")
        )
          throw new ApiError(400, "The MA skill API only accepts ZIP files.");
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
        throw new ApiError(400, "Please choose a file to upload first.");
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
    // After creating/importing a session, let the task page continue the conversation;
    // tenant authorization is always determined by the current upstream credentials.
    if (["CreateSession", "GetSession", "ListSessions"].includes(op.id)) {
      const payload = result as {
        data?: import("../shared/types").Session[];
      } & import("../shared/types").Session;
      for (const session of payload.data ?? [payload])
        if (session.id) {
          const old = runtime.store.get(session.id);
          const value = {
            ...session,
            title: session.title || "Untitled task",
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
    // The raw HTTP body from the credential-validation API may carry a refreshed
    // token; do not expose it to the client.
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
