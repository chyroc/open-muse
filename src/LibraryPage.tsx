import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FileText,
  Image,
  LoaderCircle,
  Music2,
  Share2,
  Shapes,
  Video,
} from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import { fileSizeLabel, type LibraryFile } from "../shared/library";
import type { LibraryItem } from "../shared/types";
import type { Client } from "./api";
import { Markdown, dateLabel } from "./components";
import { Sheet } from "./MusePages";
import { useRefreshHandler } from "./PullToRefresh";
import { PopoverMenu } from "./PopoverMenu";
import { exportText } from "./platform";
import {
  canRenderThumbnails,
  libraryThumbnail,
  openLibraryFile,
} from "./library-platform";
import "./library.css";

type Section = "artifacts" | "media";
const fileIcons = {
  artifact: FileText,
  image: Image,
  audio: Music2,
  video: Video,
};

export function wantsThumbnail(item: LibraryFile) {
  return (
    item.kind === "image" &&
    item.status === "active" &&
    (item.bytes == null || item.bytes <= 10 * 1024 * 1024)
  );
}

// Loads each id once with a small worker pool; results arrive as they finish.
export async function loadThumbnails(
  ids: readonly string[],
  load: (id: string) => Promise<string | undefined>,
  done: (id: string, data: string | undefined) => void,
  cancelled: () => boolean,
  concurrency = 2,
) {
  let next = 0;
  const worker = async () => {
    while (!cancelled() && next < ids.length) {
      const id = ids[next++];
      let data: string | undefined;
      try {
        data = await load(id);
      } catch {
        data = undefined;
      }
      if (!cancelled()) done(id, data);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, worker),
  );
}

// A file extension reads better than a generic MIME type such as text/plain.
export function fileTypeLabel(item: LibraryFile) {
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
  thumbnail,
  onOpen,
}: {
  item: LibraryFile;
  thumbnail?: string;
  onOpen: () => void;
}) {
  const Icon = fileIcons[item.kind];
  return (
    <button
      className="library-card file-card"
      aria-label={t("Open file: {name}", { name: item.name })}
      onClick={onOpen}
    >
      {thumbnail ? (
        <div className="library-file-cover has-thumbnail">
          <img src={thumbnail} alt="" draggable={false} />
        </div>
      ) : (
        <div className={`library-file-cover file-${item.kind}`}>
          <Icon size={38} strokeWidth={1.5} />
          <span>{fileTypeLabel(item)}</span>
        </div>
      )}
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

type Layout = "grid" | "list";
type Order = "modified" | "title";

export function LibraryPage({
  client,
  optionsOpen = false,
  onOptionsClose = () => {},
}: {
  client: Client;
  optionsOpen?: boolean;
  onOptionsClose?: () => void;
}) {
  const [layout, setLayout] = useState<Layout>("list");
  const [order, setOrder] = useState<Order>("modified");
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
  useRefreshHandler(reload);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [reload]);
  // Newest first, or alphabetical by name in the interface language.
  const sorted = <T,>(
    list: T[],
    name: (item: T) => string,
    at: (item: T) => string,
  ) =>
    [...list].sort((a, b) =>
      order === "title"
        ? name(a).localeCompare(name(b), formatLocale())
        : at(b).localeCompare(at(a)),
    );
  const visible = sorted(
    files.filter((item) =>
      section === "artifacts"
        ? item.kind === "artifact"
        : item.kind !== "artifact",
    ),
    (item) => item.name,
    (item) => item.created_at,
  );
  // Thumbnails live only in this page's memory; signed URLs are never kept.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (section !== "media" || !canRenderThumbnails()) return;
    const ids = files
      .filter((item) => wantsThumbnail(item) && !requested.current.has(item.id))
      .map((item) => item.id);
    if (!ids.length) return;
    ids.forEach((id) => requested.current.add(id));
    const settled = new Set<string>();
    let stopped = false;
    void loadThumbnails(
      ids,
      (id) =>
        libraryThumbnail(
          async () => (await client.libraryFileDownload(id)).url,
        ),
      (id, data) => {
        settled.add(id);
        if (data) setThumbnails((current) => ({ ...current, [id]: data }));
      },
      () => stopped || !alive.current,
    );
    return () => {
      stopped = true;
      // Unfinished requests may be retried when the section is shown again.
      for (const id of ids) if (!settled.has(id)) requested.current.delete(id);
    };
  }, [section, files, client]);
  const savedVisible = sorted(
    section === "artifacts" ? items : [],
    (item) => item.title,
    (item) => item.created_at,
  );
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
          <div className={`library-grid ${layout}`}>
            {visible.map((item) => (
              <LibraryFileCard
                key={item.id}
                item={item}
                thumbnail={thumbnails[item.id]}
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
            <div className={`library-grid ${layout}`}>
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
      {optionsOpen && (
        <PopoverMenu
          label={t("Library options")}
          onClose={onOptionsClose}
          items={[
            {
              kind: "item",
              label: t("Show as list"),
              checked: layout === "list",
              onSelect: () => setLayout("list"),
            },
            {
              kind: "item",
              label: t("Show as grid"),
              checked: layout === "grid",
              onSelect: () => setLayout("grid"),
            },
            { kind: "separator" },
            {
              kind: "item",
              label: t("Last modified"),
              checked: order === "modified",
              onSelect: () => setOrder("modified"),
            },
            {
              kind: "item",
              label: t("Title"),
              checked: order === "title",
              onSelect: () => setOrder("title"),
            },
          ]}
        />
      )}
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
                  thumbnail={thumbnails[selected.id]}
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
