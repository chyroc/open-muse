import { t } from "../../shared/i18n";
import { operations } from "../../shared/ma";
import {
  buildRequest,
  inputSchema,
  redactSecrets,
} from "../../shared/ma-request";
import { ApiError, type ArkClient } from "../../shared/ark";
import { unbase64 } from "../../shared/crypto";
import type { DirectAuth } from "./auth";

export async function executeOperation(
  ark: ArkClient,
  auth: DirectAuth,
  operation: string,
  body: object,
) {
  const op = operations.find((value) => value.id === operation);
  if (!op) throw new ApiError(404, t("Unregistered MA operation."));
  const input = inputSchema.parse(body);
  if (op.method !== "GET" && !op.id.startsWith("List") && !input.confirm)
    throw new ApiError(
      400,
      t("Confirm the target and impact before modifying cloud resources."),
    );
  const path = buildRequest(op, input);
  if (op.id === "StreamSessionEvents")
    throw new ApiError(
      400,
      t("Open the conversation to view the live event stream."),
    );
  let result: unknown;
  if (op.transport === "top") {
    result = await auth.action(op.id, {
      ...input.body,
      ...(op.fields.some((f) => f.name === "ProjectName")
        ? { ProjectName: auth.value?.project }
        : {}),
    });
  } else if (["CreateSkill", "UploadFile"].includes(op.id)) {
    const form = new FormData();
    for (const [key, value] of Object.entries(input.body)) {
      if (value === undefined) continue;
      if (key === "tos" && value && typeof value === "object") {
        for (const [name, item] of Object.entries(value)) {
          if (!["bucket", "prefix"].includes(name) || typeof item !== "string")
            throw new ApiError(
              400,
              t("tos only supports bucket and prefix strings."),
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
        throw new ApiError(400, t("File names must not contain paths."));
      const bytes = unbase64(input.file.base64);
      if (bytes.length > 10 * 1024 * 1024)
        throw new ApiError(413, t("Files must be at most 10 MB."));
      if (
        op.id === "CreateSkill" &&
        (!input.file.name.endsWith(".zip") ||
          bytes[0] !== 80 ||
          bytes[1] !== 75)
      )
        throw new ApiError(400, t("Skills must be ZIP files."));
      form.append(
        op.id === "CreateSkill" ? "files" : "file",
        new Blob([bytes as Uint8Array<ArrayBuffer>], {
          type:
            op.id === "CreateSkill"
              ? "application/zip"
              : "application/octet-stream",
        }),
        input.file.name,
      );
    } else if (op.id === "CreateSkill" || !input.body.url)
      throw new ApiError(400, t("Choose a file to upload first."));
    result = await ark.request(path, { method: "POST", body: form });
  } else
    result = await ark.request(path, {
      method: op.method,
      ...(op.id === "GetFile"
        ? { headers: { "X-Ark-PreSignedURL-ExpiresAfter": "86400" } }
        : {}),
      ...(op.method === "POST" ? { body: JSON.stringify(input.body) } : {}),
    });
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
  return redactSecrets(
    op.id === "ValidateCredential" ? maskBodies(result) : result,
  );
}
