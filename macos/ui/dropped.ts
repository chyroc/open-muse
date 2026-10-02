import { maxAttachments } from "../../shared/attachments";

// Files dropped on the floating pill arrive from the shell as base64; they go
// through the same staging checks as files dropped on the composer.
export const droppedFilesEvent = "muse-dropped-files";

export function droppedFiles(detail: unknown): File[] {
  if (!Array.isArray(detail)) return [];
  const files: File[] = [];
  for (const item of detail.slice(0, maxAttachments)) {
    if (!item || typeof item !== "object") continue;
    const { name, type, data } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name || typeof data !== "string") continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const binary = atob(data);
      bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++)
        bytes[index] = binary.charCodeAt(index);
    } catch {
      continue;
    }
    files.push(
      new File([bytes], name, { type: typeof type === "string" ? type : "" }),
    );
  }
  return files;
}
