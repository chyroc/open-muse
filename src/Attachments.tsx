import { FileText, Image, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { t } from "../shared/i18n";
import type {
  Attachment,
  AttachmentKind,
  SentAttachment,
} from "../shared/attachments";
import "./attachments.css";

export interface StagedAttachment {
  key: string;
  name: string;
  kind: AttachmentKind;
  state: "uploading" | "ready" | "failed";
  value?: Attachment;
  error?: string;
  preview?: string;
  // Shown in place of the upload status while the item is being prepared.
  note?: string;
}

// A small local preview for the staging chip; the original never leaves the
// upload path and no object URL is created.
export async function imagePreview(file: Blob): Promise<string | undefined> {
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

export function StagedAttachments({
  items,
  onRemove,
}: {
  items: readonly StagedAttachment[];
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="staged-attachments" aria-label={t("Attachments")}>
      {items.map((item) => (
        <li key={item.key} className={`staged-attachment is-${item.state}`}>
          <span className="attachment-thumb" aria-hidden="true">
            {item.preview ? (
              <img src={item.preview} alt="" />
            ) : item.kind === "image" ? (
              <Image size={18} />
            ) : (
              <FileText size={18} />
            )}
          </span>
          <span className="attachment-text">
            <strong>{item.name}</strong>
            <small role={item.state === "failed" ? "alert" : "status"}>
              {item.state === "uploading" ? (
                <>
                  <LoaderCircle size={12} className="spin" />
                  {item.note ?? t("Uploading…")}
                </>
              ) : item.state === "failed" ? (
                <>
                  <TriangleAlert size={12} />
                  {item.error ?? t("Upload failed")}
                </>
              ) : (
                t("Ready to send")
              )}
            </small>
          </span>
          <button
            type="button"
            aria-label={t("Remove attachment: {name}", { name: item.name })}
            disabled={item.state === "uploading"}
            onClick={() => onRemove(item.key)}
          >
            <X size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MessageAttachments({
  items,
}: {
  items: readonly SentAttachment[];
}) {
  if (!items.length) return null;
  return (
    <ul className="message-attachments" aria-label={t("Attachments")}>
      {items.map((item) => (
        <li key={item.key}>
          {item.kind === "image" ? (
            <Image size={16} aria-hidden="true" />
          ) : (
            <FileText size={16} aria-hidden="true" />
          )}
          <span>{item.name}</span>
        </li>
      ))}
    </ul>
  );
}
