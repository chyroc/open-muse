import { useEffect, useRef, type ReactNode } from "react";
import { Camera, Image as ImageIcon, Paperclip } from "lucide-react";
import { t } from "../shared/i18n";
import { documentAccept, imageAccept } from "../shared/attachments";
import "./attachment-sheet.css";

type Source = "camera" | "photos" | "files";

// A floating sheet for adding attachments: camera and photo tiles, then a
// row for documents. It springs up from the composer and closes on choice,
// on a tap outside, or with Escape.
export function AttachmentSheet({
  onClose,
  onFiles,
}: {
  onClose: () => void;
  onFiles: (files: File[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputs = {
    camera: useRef<HTMLInputElement>(null),
    photos: useRef<HTMLInputElement>(null),
    files: useRef<HTMLInputElement>(null),
  };
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
  const picker = (source: Source, accept: string, capture?: boolean) => (
    <input
      ref={inputs[source]}
      type="file"
      hidden
      multiple={source !== "camera"}
      accept={accept}
      {...(capture ? { capture: "environment" } : {})}
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        onClose();
        if (files.length) onFiles(files);
      }}
    />
  );
  const tile = (source: Source, label: string, icon: ReactNode) => (
    <button
      type="button"
      className="attach-tile"
      aria-label={label}
      onClick={() => inputs[source].current?.click()}
    >
      {icon}
    </button>
  );
  return (
    <dialog
      ref={dialog}
      className="attach-sheet"
      tabIndex={-1}
      aria-label={t("Add attachment")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {picker("camera", imageAccept, true)}
      {picker("photos", imageAccept)}
      {picker("files", documentAccept)}
      <h2>{t("Library")}</h2>
      <div className="attach-tiles">
        {tile("camera", t("Camera"), <Camera size={26} strokeWidth={1.8} />)}
        {tile("photos", t("Photos"), <ImageIcon size={26} strokeWidth={1.8} />)}
      </div>
      <div className="attach-rows">
        <button type="button" onClick={() => inputs.files.current?.click()}>
          <Paperclip size={22} strokeWidth={1.8} aria-hidden="true" />
          {t("Add file")}
        </button>
      </div>
    </dialog>
  );
}
