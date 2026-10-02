import { z } from "zod";
import { ApiError, type ArkClient } from "../../shared/ark";
import { t } from "../../shared/i18n";
import { uuid } from "../../shared/crypto";
import {
  checkAttachment,
  maxInlineCharacters,
  type Attachment,
} from "../../shared/attachments";

const uploaded = z.object({
  id: z.string().regex(/^[\w-]{1,200}$/),
  purpose: z.literal("user_data"),
  status: z.enum(["active", "processing", "failed"]),
});

// Uploads are writes and are never retried automatically. A failed or
// unconfirmed upload is reported so the user can choose to attach again.
export class DirectAttachments {
  constructor(
    private ark: ArkClient,
    private wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async upload(
    file: Blob,
    name: string,
    staged: number,
    signal?: AbortSignal,
  ): Promise<Attachment> {
    const clean = name
      .replace(/[\\/\r\n\t]/g, "-")
      .trim()
      .slice(0, 255);
    const { kind, mime, inline } = checkAttachment(
      clean,
      file.type,
      file.size,
      staged,
    );
    if (inline) {
      // Decoded strictly so binary data renamed as text is not sent to the model.
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new ApiError(400, t("This text file is not valid UTF-8."));
      }
      if (!text.trim()) throw new ApiError(400, t("This file is empty."));
      if (text.length > maxInlineCharacters)
        throw new ApiError(
          413,
          t("Text attachments can be at most {count} characters.", {
            count: maxInlineCharacters.toLocaleString(),
          }),
        );
      return { name: clean, kind: "document", text };
    }
    const stored = storedName(clean);
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append("file", new Blob([file], { type: mime }), stored);
    const result = uploaded.safeParse(
      await this.ark.request("/files", { method: "POST", body: form, signal }),
    );
    if (!result.success)
      throw new ApiError(502, t("MA returned an unexpected upload result."));
    let status = result.data.status;
    const path = `/files/${encodeURIComponent(result.data.id)}`;
    for (let attempt = 0; status === "processing" && attempt < 20; attempt++) {
      await this.wait(1000);
      signal?.throwIfAborted();
      const current = uploaded.safeParse(
        await this.ark.request(path, { signal }),
      );
      if (!current.success || current.data.id !== result.data.id)
        throw new ApiError(502, t("MA returned an unexpected upload result."));
      status = current.data.status;
    }
    if (status !== "active")
      throw new ApiError(
        status === "failed" ? 422 : 504,
        status === "failed"
          ? t("MA could not process this file.")
          : t("This file is still processing. Remove it and attach it again."),
      );
    return { file_id: result.data.id, name: clean, kind, stored };
  }

  // Mounting copies the file into the session sandbox at a path derived from
  // its stored name. This is a write and is never retried here.
  async mount(sessionId: string, fileId: string, signal?: AbortSignal) {
    const result = mounted.safeParse(
      await this.ark.request(
        `/sessions/${encodeURIComponent(sessionId)}/resources`,
        {
          method: "POST",
          body: JSON.stringify({ type: "file", file_id: fileId }),
          signal,
        },
      ),
    );
    if (!result.success)
      throw new ApiError(502, t("MA returned an unexpected upload result."));
    return result.data.mount_path;
  }

  // Maps stored file names to their sandbox paths, to confirm an earlier
  // mount whose result was not received.
  async mountedPaths(sessionId: string, signal?: AbortSignal) {
    const page = z
      .object({ data: z.array(z.unknown()) })
      .safeParse(
        await this.ark.request(
          `/sessions/${encodeURIComponent(sessionId)}/resources?limit=100`,
          { signal },
        ),
      );
    if (!page.success)
      throw new ApiError(502, t("MA returned an unexpected upload result."));
    const paths = new Map<string, string>();
    for (const row of page.data.data) {
      const item = mounted.safeParse(row);
      if (item.success)
        paths.set(item.data.mount_path.split("/").pop()!, item.data.mount_path);
    }
    return paths;
  }
}

const mounted = z.object({
  type: z.literal("file"),
  mount_path: z
    .string()
    .max(512)
    .regex(/^\/mnt\/session\/uploads\/[^/\0]+$/),
});

// A short random suffix keeps two same-named files from sharing one sandbox
// path in a session. People still see the original name.
function storedName(name: string) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  return `${stem.slice(0, 200)}-${uuid().slice(0, 8)}${extension}`;
}
