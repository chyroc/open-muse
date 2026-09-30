import { z } from "zod";
import type { MAOperation } from "./ma";
import { ApiError } from "./ark";
const record = z.record(z.string(), z.unknown());
export const inputSchema = z.object({
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
