import { FileText, Image, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  checkAttachment,
  type Attachment,
  type AttachmentKind,
  type SentAttachment,
} from "../../shared/attachments";

export type Staged = {
  key: string;
  name: string;
  kind: AttachmentKind;
  state: "uploading" | "ready" | "failed";
  value?: Attachment;
  error?: string;
  preview?: string;
};

// A small local thumbnail for the chip; the file itself only travels through
// the upload path.
export async function thumbnail(file: Blob) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return undefined;
  }
}

// Checks a file against the shared limits before anything is uploaded.
export function stageFile(file: File, count: number, key: string): Staged {
  try {
    const { kind } = checkAttachment(file.name, file.type, file.size, count);
    return { key, name: file.name, kind, state: "uploading" };
  } catch (failure) {
    return {
      key,
      name: file.name,
      kind: file.type.startsWith("image/") ? "image" : "document",
      state: "failed",
      error: (failure as Error).message,
    };
  }
}

export function StagedFiles({
  items,
  onRemove,
}: {
  items: readonly Staged[];
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mac-staged" aria-label={t("Attachments")}>
      {items.map((item) => (
        <li key={item.key} className={`is-${item.state}`}>
          <span className="mac-staged-thumb" aria-hidden="true">
            {item.preview ? (
              <img src={item.preview} alt="" />
            ) : item.kind === "image" ? (
              <Image size={16} />
            ) : (
              <FileText size={16} />
            )}
          </span>
          <span className="mac-staged-text">
            <strong>{item.name}</strong>
            {item.state === "uploading" && (
              <small role="status">
                <LoaderCircle size={11} className="spin" />
                {t("Uploading…")}
              </small>
            )}
            {item.state === "failed" && (
              <small role="alert">
                <TriangleAlert size={11} />
                {item.error}
              </small>
            )}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("Remove attachment: {name}", { name: item.name })}
            onClick={() => onRemove(item.key)}
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SentFiles({ items }: { items: readonly SentAttachment[] }) {
  if (!items.length) return null;
  return (
    <ul className="mac-sent-files" aria-label={t("Attachments")}>
      {items.map((item) => (
        <li key={item.key}>
          {item.kind === "image" ? <Image size={14} /> : <FileText size={14} />}
          <span>{item.name}</span>
        </li>
      ))}
    </ul>
  );
}
