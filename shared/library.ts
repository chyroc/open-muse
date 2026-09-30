import { z } from "zod";
import { ApiError } from "./ark";
import { formatLocale, t } from "./i18n";

export type LibraryFileKind = "artifact" | "image" | "audio" | "video";
export interface LibraryFile {
  id: string;
  name: string;
  mime_type: string;
  bytes?: number;
  status: "active" | "processing" | "failed";
  kind: LibraryFileKind;
  session_id: string;
  session_title: string;
  created_at: string;
  expires_at?: string;
}

export const fileId = z.string().regex(/^[\w-]{1,200}$/);
export const fileObject = z.object({
  id: fileId,
  purpose: z.string(),
  filename: z.string().min(1).max(1024),
  mime_type: z.string().max(200).nullish(),
  bytes: z.number().int().nonnegative().nullish(),
  created_at: z.number().int().nonnegative().max(8_000_000_000),
  expire_at: z.number().int().nonnegative().max(8_000_000_000).nullish(),
  status: z.enum(["active", "processing", "failed"]),
  scope: z.object({ type: z.string(), id: fileId }).nullish(),
  download_url: z.string().max(16000).nullish(),
});

export function libraryFileKind(mime: string): LibraryFileKind {
  const type = mime.split(";")[0].trim().toLowerCase();
  // SVG remains a document, rather than executable markup in an image view.
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "artifact";
}

export function libraryFile(
  raw: unknown,
  sessions: ReadonlyMap<string, string>,
  now = Date.now(),
): LibraryFile | undefined {
  const parsed = fileObject.safeParse(raw);
  if (!parsed.success) return;
  const file = parsed.data;
  if (
    file.purpose !== "agent" ||
    file.scope?.type !== "session" ||
    !sessions.has(file.scope.id) ||
    // MA keeps agent outputs for a limited time; expired files cannot open.
    (file.expire_at != null && file.expire_at * 1000 <= now)
  )
    return;
  const mime_type = file.mime_type || "application/octet-stream";
  return {
    id: file.id,
    name: file.filename,
    mime_type,
    ...(file.bytes != null ? { bytes: file.bytes } : {}),
    status: file.status,
    kind: libraryFileKind(mime_type),
    session_id: file.scope.id,
    session_title: sessions.get(file.scope.id)!,
    created_at: new Date(file.created_at * 1000).toISOString(),
    ...(file.expire_at != null
      ? { expires_at: new Date(file.expire_at * 1000).toISOString() }
      : {}),
  };
}

export function fileSizeLabel(bytes: number) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(formatLocale(), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit ? 1 : 0,
  }).format(value);
}

// Signed URLs are capabilities. Validate them only at the moment of use and
// never persist them with library metadata or send MA authorization to TOS.
export function libraryDownloadURL(value: unknown): string {
  try {
    if (typeof value !== "string" || value.length > 16000) throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9][a-z0-9-]*\.tos-cn-beijing\.volces\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw new Error();
    return url.href;
  } catch {
    throw new ApiError(
      502,
      t("MA did not return a supported file download address."),
    );
  }
}
