import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { t } from "../shared/i18n";
import { fileSizeLabel, type LibraryFile } from "../shared/library";
import type { Client } from "./api";
import { fileTypeLabel, wantsThumbnail } from "./LibraryPage";
import { libraryThumbnail, openLibraryFile } from "./library-platform";
import "./turn-outputs.css";

// What the companion saved to the Library during a turn, under its reply:
// images as thumbnails, a PDF as a card showing its first page, and other
// files as cards, each opening the Library's own preview.
export function TurnOutputs({
  files,
  client,
}: {
  files: readonly LibraryFile[];
  client: Pick<Client, "libraryFileDownload">;
}) {
  const [error, setError] = useState("");
  const open = async (file: LibraryFile) => {
    setError("");
    try {
      const { url, item } = await client.libraryFileDownload(file.id);
      await openLibraryFile(url, item.name, "preview");
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const images = files.filter((file) => file.kind === "image");
  const others = files.filter((file) => file.kind !== "image");
  return (
    <div className="turn-outputs">
      {images.length > 0 && (
        <ul className="turn-output-images" aria-label={t("Images")}>
          {images.map((file) => (
            <OutputImage
              key={file.id}
              file={file}
              client={client}
              onOpen={() => void open(file)}
            />
          ))}
        </ul>
      )}
      {others.map((file) =>
        isPdf(file) ? (
          <OutputDocument
            key={file.id}
            file={file}
            client={client}
            onOpen={() => void open(file)}
          />
        ) : (
          <button
            key={file.id}
            type="button"
            className="turn-output-file"
            onClick={() => void open(file)}
          >
            <span className="turn-output-type" aria-hidden="true">
              {fileTypeLabel(file).slice(0, 4) || <FileText size={18} />}
            </span>
            <span className="turn-output-text">
              <strong>{file.name}</strong>
              <small>
                {fileTypeLabel(file)}
                {file.bytes != null && ` · ${fileSizeLabel(file.bytes)}`}
              </small>
            </span>
          </button>
        ),
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function OutputImage({
  file,
  client,
  onOpen,
}: {
  file: LibraryFile;
  client: Pick<Client, "libraryFileDownload">;
  onOpen: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string>();
  useEffect(() => {
    if (!wantsThumbnail(file)) return;
    let active = true;
    void libraryThumbnail(
      async () => (await client.libraryFileDownload(file.id)).url,
    ).then(
      (data) => active && setThumbnail(data),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [file, client]);
  return (
    <li>
      <button
        type="button"
        className="turn-output-image"
        aria-label={t("Open {name}", { name: file.name })}
        onClick={onOpen}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <ImageIcon size={22} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

const isPdf = (file: LibraryFile) =>
  file.mime_type.split(";")[0] === "application/pdf" ||
  /\.pdf$/i.test(file.name);

// A PDF's card: its first page on top, cropped to the card, then its name
// and size. The page is drawn on the device; until it arrives the card keeps
// its room, and without one it is a plain file card.
function OutputDocument({
  file,
  client,
  onOpen,
}: {
  file: LibraryFile;
  client: Pick<Client, "libraryFileDownload">;
  onOpen: () => void;
}) {
  const previewable =
    file.status === "active" &&
    (file.bytes == null || file.bytes <= 10 * 1024 * 1024);
  const [page, setPage] = useState<string | null>();
  useEffect(() => {
    if (!previewable) return;
    let active = true;
    void libraryThumbnail(
      async () => (await client.libraryFileDownload(file.id)).url,
    ).then(
      (data) => active && setPage(data ?? null),
      () => active && setPage(null),
    );
    return () => {
      active = false;
    };
  }, [file, client, previewable]);
  return (
    <button
      type="button"
      className="turn-output-file turn-output-document"
      onClick={onOpen}
    >
      {previewable && page !== null && (
        <span className="turn-output-page" aria-hidden="true">
          {page && <img src={page} alt="" />}
        </span>
      )}
      <span className="turn-output-row">
        <span className="turn-output-type pdf" aria-hidden="true">
          PDF
        </span>
        <span className="turn-output-text">
          <strong>{file.name}</strong>
          <small>
            {fileTypeLabel(file)}
            {file.bytes != null && ` · ${fileSizeLabel(file.bytes)}`}
          </small>
        </span>
      </span>
    </button>
  );
}
