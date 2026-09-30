import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FileText,
  Image,
  LoaderCircle,
  Music2,
  RefreshCw,
  Share2,
  Shapes,
  Video,
} from "lucide-react";
import { t } from "../shared/i18n";
import { fileSizeLabel, type LibraryFile } from "../shared/library";
import type { LibraryItem } from "../shared/types";
import type { Client } from "./api";
import { Markdown, dateLabel } from "./components";
import { Sheet } from "./MusePages";
import { exportText } from "./platform";
import { openLibraryFile } from "./library-platform";
import "./library.css";

type Section = "artifacts" | "media";
const fileIcons = {
  artifact: FileText,
  image: Image,
  audio: Music2,
  video: Video,
};

// A file extension reads better than a generic MIME type such as text/plain.
function fileTypeLabel(item: LibraryFile) {
  const extension = item.name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return extension ? extension.toUpperCase() : item.mime_type.split(";")[0];
}

export function LibrarySegments({
  section,
  onSelect,
}: {
  section: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <div
      className="library-segments"
      role="tablist"
      aria-label={t("Library sections")}
    >
      <button
        role="tab"
        id="library-artifacts"
        aria-controls="library-content"
        aria-selected={section === "artifacts"}
        onClick={() => onSelect("artifacts")}
      >
        {t("Artifacts")}
      </button>
      <button
        role="tab"
        id="library-media"
        aria-controls="library-content"
        aria-selected={section === "media"}
        onClick={() => onSelect("media")}
      >
        {t("Media")}
      </button>
    </div>
  );
}

export function LibraryFileCard({
  item,
  onOpen,
}: {
  item: LibraryFile;
  onOpen: () => void;
}) {
  const Icon = fileIcons[item.kind];
  return (
    <button
      className="library-card file-card"
      aria-label={t("Open file: {name}", { name: item.name })}
      onClick={onOpen}
    >
      <div className={`library-file-cover file-${item.kind}`}>
        <Icon size={38} strokeWidth={1.5} />
        <span>{fileTypeLabel(item)}</span>
      </div>
      <strong>{item.name}</strong>
      <small>{dateLabel(item.created_at)}</small>
      {item.status !== "active" && (
        <small className="file-state">
          {item.status === "processing"
            ? t("Processing file…")
            : t("File processing failed")}
        </small>
      )}
    </button>
  );
}

export function LibraryEmpty({ section }: { section: Section }) {
  return (
    <div className="muse-empty library-empty">
      <span aria-hidden="true">
        {section === "media" ? (
          <Image size={38} strokeWidth={1.5} />
        ) : (
          <Shapes size={38} strokeWidth={1.5} />
        )}
      </span>
      <h2>
        {section === "media" ? t("No media yet") : t("Nothing created yet")}
      </h2>
      <p>
        {section === "media"
          ? t(
              "Images, audio and videos created in your conversations appear here.",
            )
          : t(
              "Documents and other files created in your conversations appear here.",
            )}
      </p>
    </div>
  );
}

export function LibraryPage({ client }: { client: Client }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [section, setSection] = useState<Section>("artifacts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LibraryItem | LibraryFile>();
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const reload = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    const [saved, outputs] = await Promise.allSettled([
      client.library(),
      client.libraryFiles(),
    ]);
    if (!alive.current || run !== generation.current) return;
    if (saved.status === "fulfilled") setItems(saved.value.data);
    if (outputs.status === "fulfilled") setFiles(outputs.value.data);
    const failures = [saved, outputs].filter(
      (result) => result.status === "rejected",
    );
    setError(
      failures
        .map((result) =>
          (result as PromiseRejectedResult).reason instanceof Error
            ? (result as PromiseRejectedResult).reason.message
            : t("Couldn't load the Library. Try refreshing."),
        )
        .join("\n"),
    );
    setLoading(false);
  }, [client]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [reload]);
  const visible = files.filter((item) =>
    section === "artifacts"
      ? item.kind === "artifact"
      : item.kind !== "artifact",
  );
  const savedVisible = section === "artifacts" ? items : [];
  const select = (item: LibraryItem | LibraryFile) => {
    setDetailError("");
    setSelected(item);
  };
  const fileAction = async (action: "preview" | "share") => {
    if (!selected || !("kind" in selected) || lock.current) return;
    lock.current = true;
    setBusy(true);
    setDetailError("");
    try {
      const { url, item } = await client.libraryFileDownload(selected.id);
      if (!alive.current) return;
      await openLibraryFile(url, item.name, action);
    } catch (e) {
      if (alive.current) setDetailError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="muse-page library-page" aria-label={t("Library")}>
      <LibrarySegments section={section} onSelect={setSection} />
      <div className="library-toolbar">
        {loading && (
          <span role="status">
            <LoaderCircle className="spin" size={17} />
            {t("Loading…")}
          </span>
        )}
        <button
          className="icon-button"
          aria-label={t("Refresh Library")}
          disabled={loading}
          onClick={() => void reload()}
        >
          <RefreshCw size={19} />
        </button>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={() => void reload()} disabled={loading}>
            {t("Retry")}
          </button>
        </div>
      )}
      <div
        role="tabpanel"
        id="library-content"
        aria-labelledby={
          section === "artifacts" ? "library-artifacts" : "library-media"
        }
      >
        {!visible.length && !savedVisible.length && !loading && !error && (
          <LibraryEmpty section={section} />
        )}
        {!!visible.length && (
          <div className="library-grid">
            {visible.map((item) => (
              <LibraryFileCard
                key={item.id}
                item={item}
                onOpen={() => select(item)}
              />
            ))}
          </div>
        )}
        {!!savedVisible.length && (
          <>
            <div className="library-section">
              <FileText size={18} />
              <strong>{t("Saved replies")}</strong>
              <span>{savedVisible.length}</span>
            </div>
            <div className="library-grid">
              {savedVisible.map((item) => (
                <button
                  className="library-card"
                  key={item.id}
                  onClick={() => select(item)}
                >
                  <div className="document-preview">
                    <FileText size={22} />
                    <p>{item.text.replace(/[#*>`]/g, "").slice(0, 220)}</p>
                  </div>
                  <strong>{item.title}</strong>
                  <small>{dateLabel(item.created_at)}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {selected && (
        <Sheet
          title={"kind" in selected ? selected.name : selected.title}
          onClose={() => {
            if (!busy) setSelected(undefined);
          }}
        >
          {"kind" in selected ? (
            <>
              <div className="library-file-info">
                <LibraryFileCard
                  item={selected}
                  onOpen={() => void fileAction("preview")}
                />
                <p>{selected.session_title}</p>
                {selected.bytes != null && (
                  <small>
                    {t("Size: {size}", { size: fileSizeLabel(selected.bytes) })}
                  </small>
                )}
                {selected.expires_at && (
                  <small>
                    {t("Available until {date}", {
                      date: dateLabel(selected.expires_at),
                    })}
                  </small>
                )}
              </div>
              <div className="library-file-actions">
                <button
                  className="button primary"
                  disabled={busy || selected.status !== "active"}
                  onClick={() => void fileAction("preview")}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <FileText size={18} />
                  )}
                  {t("Preview file")}
                </button>
                <button
                  className="button secondary"
                  disabled={busy || selected.status !== "active"}
                  onClick={() => void fileAction("share")}
                >
                  <Share2 size={18} />
                  {t("Share file")}
                </button>
              </div>
            </>
          ) : (
            <Markdown text={selected.text} />
          )}
          <div className="library-detail-actions">
            <a
              className="button secondary"
              href={`#/task/${encodeURIComponent(selected.session_id)}`}
              onClick={() => setSelected(undefined)}
            >
              {t("View source conversation")}
              <ArrowRight size={16} />
            </a>
            {!("kind" in selected) && (
              <button
                className="icon-button"
                aria-label={t("Export item")}
                disabled={busy}
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setDetailError("");
                  try {
                    await exportText(`${selected.title}.md`, selected.text);
                  } catch (e) {
                    if (alive.current) setDetailError((e as Error).message);
                  } finally {
                    lock.current = false;
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                <ArrowDownToLine size={21} />
              </button>
            )}
          </div>
          {detailError && (
            <div className="inline-error" role="alert">
              {detailError}
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
