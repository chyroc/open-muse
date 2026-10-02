import { useEffect, useState } from "react";
import {
  FileText,
  Image,
  LoaderCircle,
  Play,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import { t } from "../shared/i18n";
import type {
  Attachment,
  AttachmentKind,
  SentAttachment,
} from "../shared/attachments";
import { groupFrames } from "./videoFrames";
import type { KeptMedia } from "./direct/media";
import { MediaViewer, useObjectURL } from "./MediaViewer";
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
  // A video's frames show as one attachment, removed together.
  const chips = groupFrames(items).map(({ video, items: group }) => {
    if (!video) return { item: group[0], keys: [group[0].key] };
    const state: StagedAttachment["state"] = group.some(
      (frame) => frame.state === "failed",
    )
      ? "failed"
      : group.some((frame) => frame.state === "uploading")
        ? "uploading"
        : "ready";
    return {
      item: {
        ...group[0],
        name: t("Video"),
        state,
        preview: group.find((frame) => frame.preview)?.preview,
        error: group.find((frame) => frame.error)?.error,
        video: true,
      },
      keys: group.map((frame) => frame.key),
    };
  });
  return (
    <ul className="staged-attachments" aria-label={t("Attachments")}>
      {chips.map(({ item, keys }) => (
        <li key={item.key} className={`staged-attachment is-${item.state}`}>
          <span className="attachment-thumb" aria-hidden="true">
            {item.preview ? (
              <img src={item.preview} alt="" />
            ) : "video" in item ? (
              <Video size={18} />
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
            onClick={() => keys.forEach(onRemove)}
          >
            <X size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// A sent photo or video as a thumbnail that opens full screen. Only this
// device's own copies can be shown; anything else opens to a short note.
function MediaTile({
  fileId,
  video,
  load,
  onOpen,
}: {
  fileId: string;
  video: boolean;
  load?: (fileId: string) => Promise<KeptMedia | undefined>;
  onOpen: (media?: KeptMedia) => void;
}) {
  const [media, setMedia] = useState<KeptMedia>();
  useEffect(() => {
    let active = true;
    void load?.(fileId).then((value) => active && setMedia(value));
    return () => {
      active = false;
    };
  }, [fileId, load]);
  const url = useObjectURL(
    media?.kind === "video" ? media.poster : media?.blob,
  );
  return (
    <li className="message-media-item">
      <button
        type="button"
        className="message-media"
        aria-label={video ? t("Open video") : t("Open image")}
        onClick={() => onOpen(media)}
      >
        {url ? (
          <img src={url} alt="" />
        ) : video ? (
          <Video size={22} aria-hidden="true" />
        ) : (
          <Image size={22} aria-hidden="true" />
        )}
        {video && (
          <span className="message-media-play" aria-hidden="true">
            <Play size={16} fill="currentColor" />
          </span>
        )}
      </button>
    </li>
  );
}

export function MessageAttachments({
  items,
  load,
}: {
  items: readonly SentAttachment[];
  // Reads this device's copy of a sent photo or video by file ID.
  load?: (fileId: string) => Promise<KeptMedia | undefined>;
}) {
  const [viewing, setViewing] = useState<{ media?: KeptMedia }>();
  if (!items.length) return null;
  return (
    <>
      <ul className="message-attachments" aria-label={t("Attachments")}>
        {groupFrames(items).map(({ video, items: group }) =>
          video || group[0].kind === "image" ? (
            <MediaTile
              key={group[0].key}
              fileId={group[0].key}
              video={Boolean(video)}
              load={load}
              onOpen={(media) => setViewing({ media })}
            />
          ) : (
            <li key={group[0].key}>
              <FileText size={16} aria-hidden="true" />
              <span>{group[0].name}</span>
            </li>
          ),
        )}
      </ul>
      {viewing && (
        <MediaViewer
          media={viewing.media}
          onClose={() => setViewing(undefined)}
        />
      )}
    </>
  );
}
