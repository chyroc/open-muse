import { useEffect, useRef, useState } from "react";
import { ImageOff, X } from "lucide-react";
import { t } from "../shared/i18n";
import type { KeptMedia } from "./direct/media";
import { animateAway, useDragToDismiss } from "./gesture";
import "./media-viewer.css";

// An object URL for a blob for as long as the component shows it.
export function useObjectURL(blob?: Blob) {
  const [url, setURL] = useState<string>();
  useEffect(() => {
    if (!blob) return setURL(undefined);
    const next = URL.createObjectURL(blob);
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

// A sent photo or video opened full screen over a black backdrop: it fades
// and scales up, follows a finger down, and is let go past the dismiss
// distance or with a flick. Without a copy on this device it says so.
export function MediaViewer({
  media,
  onClose,
}: {
  media?: KeptMedia;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const url = useObjectURL(media?.blob);
  const poster = useObjectURL(
    media?.kind === "video" ? media.poster : undefined,
  );
  const [pulled, setPulled] = useState(0);
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    dialog.current?.classList.add("closing");
    animateAway(stage.current, "y", 1, onClose);
  };
  const drag = useDragToDismiss({
    target: stage,
    axis: "y",
    direction: 1,
    onDismiss: dismiss,
    onProgress: (progress, dragging) => setPulled(dragging ? progress : 0),
  });
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="media-viewer"
      tabIndex={-1}
      aria-label={media?.kind === "video" ? t("Video") : t("Image")}
      style={{ "--media-pull": pulled } as React.CSSProperties}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <button
        type="button"
        className="media-viewer-close"
        aria-label={t("Close")}
        onClick={dismiss}
      >
        <X size={22} strokeWidth={2.2} />
      </button>
      <div ref={stage} className="media-viewer-stage" {...drag}>
        {!media ? (
          <p className="media-viewer-missing">
            <ImageOff size={28} aria-hidden="true" />
            {t("This can only be opened on the device that sent it.")}
          </p>
        ) : media.kind === "video" ? (
          url && (
            <video src={url} poster={poster} controls autoPlay playsInline />
          )
        ) : (
          url && <img src={url} alt="" />
        )}
      </div>
    </dialog>
  );
}
