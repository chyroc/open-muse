import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  Download,
  FileText,
  Folder,
  Globe,
  Image,
  LayoutGrid,
  List,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  Search,
  ListFilter,
  Trash2,
  X,
  createLucideIcon,
} from "lucide-react";
import { formatLocale, t } from "../../shared/i18n";
import type { LibraryItem } from "../../shared/types";
import type {
  IdentityDocumentName,
  CompanionIdentity,
} from "../../shared/identity";
import type { Client } from "../../src/api";
import { Markdown } from "../../src/components";
import { Empty, LibraryIcon, Modal } from "./Chrome";
import { navLabel as sectionName } from "./labels";
import {
  emptyLibraryPresentation,
  exportLibraryDocument,
  libraryGroups,
  libraryPath,
  libraryViews,
  MacLibrary,
  type LibraryView,
} from "./library";
import "./library.css";

// Videos: a clip in front of another, with a play mark.
const VideoIcon = createLucideIcon("video-stack", [
  ["path", { d: "M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16", key: "back" }],
  [
    "rect",
    { x: "7.5", y: "7.5", width: "13", height: "13", rx: "2", key: "front" },
  ],
  ["path", { d: "m12.5 11.2 3.6 2.8-3.6 2.8z", key: "play" }],
]);

const icons = {
  all: LibraryIcon,
  documents: FileText,
  web: Globe,
  images: Image,
  video: VideoIcon,
  podcasts: AudioLines,
  files: Folder,
};
const navLabel = (view: LibraryView) =>
  view === "all"
    ? t("All artifacts")
    : t(libraryViews.find((item) => item.id === view)!.label);
const dateLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(formatLocale(), {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

export function LibraryPage({
  client,
  view,
  split,
  identity,
  onView,
  onDraft,
  onConnect,
  onOpenChat,
  onDocument,
}: {
  client: Client;
  view: LibraryView;
  split: boolean;
  identity: CompanionIdentity;
  onView: (view: LibraryView) => void;
  onDraft: (text: string) => void;
  onConnect: () => void;
  onOpenChat: (id: string) => void;
  onDocument: (name: IdentityDocumentName) => void;
}) {
  const service = useMemo(() => new MacLibrary(client), [client]);
  const [rows, setRows] = useState<LibraryItem[]>([]);
  const [presentation, setPresentation] = useState(emptyLibraryPresentation);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const readVersion = useRef(0);
  const live = useRef(true);
  const abort = useRef(new AbortController());
  const [sortMenu, setSortMenu] = useState(false);
  const [navMenu, setNavMenu] = useState(false);
  const [itemMenu, setItemMenu] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<LibraryItem>();
  const [remove, setRemove] = useState<LibraryItem[]>();
  const [undo, setUndo] = useState<LibraryItem[]>();
  const config = libraryViews.find((item) => item.id === view)!;
  const groups = libraryGroups(rows, presentation, view, query);
  const visible = groups.flatMap((group) => group.items);
  const searching = Boolean(query.trim());
  const supported = view === "all" || view === "documents" || searching;
  // Search replaces the category surface, so its list controls stay hidden.
  const browsing = supported && !searching;

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const version = ++readVersion.current;
    try {
      const snapshot = await service.snapshot();
      if (!live.current || version !== readVersion.current) return;
      setRows(snapshot.rows);
      setPresentation(snapshot.presentation);
      setSelected((ids) =>
        ids.filter((id) => snapshot.rows.some((row) => row.id === id)),
      );
      setPreview(
        (item) => item && snapshot.rows.find((row) => row.id === item.id),
      );
      setLoaded(true);
      setError("");
    } catch (error) {
      if (live.current && version === readVersion.current)
        setError((error as Error).message);
    }
  }, [service]);
  useEffect(() => {
    live.current = true;
    abort.current = new AbortController();
    void refresh();
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("muse-library-changed", focus);
    return () => {
      live.current = false;
      readVersion.current++;
      abort.current.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("muse-library-changed", focus);
    };
  }, [refresh]);
  useEffect(() => {
    setSelected([]);
    setSelecting(false);
    setSortMenu(false);
    setItemMenu(undefined);
    setPreview(undefined);
    setNavMenu(false);
  }, [view]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || remove) return;
      if (sortMenu || itemMenu || navMenu) {
        setSortMenu(false);
        setItemMenu(undefined);
        setNavMenu(false);
      } else if (preview) setPreview(undefined);
      else if (!(
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,[contenteditable=true]")
      )) {
        setSelecting(false);
        setSelected([]);
      }
    };
    window.addEventListener("keydown", key);
    const click = (event: MouseEvent) => {
      if (!(
        event.target instanceof Element &&
        event.target.closest(".library-menu-anchor")
      )) {
        setSortMenu(false);
        setItemMenu(undefined);
        setNavMenu(false);
      }
    };
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("click", click);
    };
  }, [sortMenu, itemMenu, navMenu, preview, remove]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    readVersion.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      if (live.current) setError((error as Error).message);
    } finally {
      busyRef.current = false;
      if (live.current) {
        setBusy(false);
        void refresh();
      }
    }
  }
  const open = (item: LibraryItem) =>
    void action(async () => {
      const state = await service.opened(item.id);
      if (!live.current) return;
      setPresentation(state);
      setPreview(item);
      setItemMenu(undefined);
    });
  const download = (item: LibraryItem) =>
    void action(async () => {
      const result = await exportLibraryDocument(item, abort.current.signal);
      if (live.current) setNotice(result);
    });
  const pin = (item: LibraryItem) =>
    void action(async () => {
      const state = await service.pin(
        item.id,
        !presentation.pinned.includes(item.id),
      );
      if (live.current) {
        setPresentation(state);
        setItemMenu(undefined);
      }
    });
  const toggleSelected = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  const itemActions = (item: LibraryItem) => (
    <div
      className="library-menu"
      role="menu"
      aria-label={t("Document options")}
    >
      <button role="menuitem" disabled={busy} onClick={() => pin(item)}>
        <Pin size={16} />
        {presentation.pinned.includes(item.id) ? t("Unpin") : t("Pin")}
      </button>
      <button
        role="menuitem"
        disabled={busy}
        onClick={() => {
          setItemMenu(undefined);
          download(item);
        }}
      >
        <Download size={16} />
        {t("Download as Markdown")}
      </button>
      <button role="menuitem" onClick={() => onOpenChat(item.session_id)}>
        <MessageCircle size={16} />
        {t("Open source conversation")}
      </button>
      <hr />
      <button
        role="menuitem"
        disabled={busy}
        onClick={() => {
          setItemMenu(undefined);
          setRemove([item]);
        }}
      >
        <Trash2 size={16} />
        {t("Remove from Library")}
      </button>
    </div>
  );
  const navItem = (id: LibraryView) => {
    const Icon = icons[id];
    return (
      <a
        href={`#${libraryPath(id)}`}
        key={id}
        aria-current={id === view ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          setQuery("");
          onView(id);
        }}
      >
        <Icon size={19} strokeWidth={1.7} />
        {navLabel(id)}
      </a>
    );
  };

  const searchField = (iconSize: number, autoFocus = false) => (
    <label className="search-field">
      <Search size={iconSize} />
      <input
        autoFocus={autoFocus}
        aria-label={t("Search Library")}
        placeholder={t("Search")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected([]);
        }}
      />
      {query && (
        <button
          className="icon-button library-clear-search"
          aria-label={t("Clear search")}
          onClick={() => {
            setQuery("");
            setSelected([]);
          }}
        >
          <X size={15} />
        </button>
      )}
    </label>
  );

  return (
    <section
      className={`library-page ${split ? "split" : ""}`}
      aria-label={sectionName("library")}
    >
      {!split && !preview && (
        <aside className="library-sidebar" aria-label={t("Library navigation")}>
          {searchField(18)}
          <h3>{t("Artifacts")}</h3>
          {(["all", "documents", "web"] as const).map(navItem)}
          <h3>{t("Media")}</h3>
          {(["images", "video", "podcasts"] as const).map(navItem)}
          <div className="library-sidebar-bottom">{navItem("files")}</div>
        </aside>
      )}
      <div className="library-main">
        {preview ? (
          <>
            <header className="library-preview-bar">
              <FileText size={20} />
              <strong title={preview.title}>{preview.title}</strong>
              <div className="library-header-spacer" />
              <button
                className="icon-button"
                aria-label={t("Open source conversation")}
                onClick={() => onOpenChat(preview.session_id)}
              >
                <MessageCircle size={19} />
              </button>
              <div className="library-menu-anchor">
                <button
                  className="icon-button"
                  aria-label={t("Document options")}
                  aria-haspopup="menu"
                  aria-expanded={itemMenu === preview.id}
                  onClick={() =>
                    setItemMenu((id) =>
                      id === preview.id ? undefined : preview.id,
                    )
                  }
                >
                  <MoreHorizontal size={20} />
                </button>
                {itemMenu === preview.id && itemActions(preview)}
              </div>
              <button
                className="icon-button"
                aria-label={t("Close document preview")}
                onClick={() => {
                  setPreview(undefined);
                  setItemMenu(undefined);
                }}
              >
                <X size={20} />
              </button>
            </header>
            <div className="library-document-scroll">
              <article className="library-document">
                <p className="library-provenance">
                  {t("Saved assistant reply")} · {dateLabel(preview.created_at)}
                </p>
                <Markdown text={preview.text} />
              </article>
            </div>
          </>
        ) : (
          <>
            <header
              className={`library-header ${selecting ? "selecting" : ""}`}
            >
              {selecting ? (
                <>
                  <h1>
                    <span className="library-title-text">
                      {t("{count} selected", { count: selected.length })}
                    </span>
                  </h1>
                  <div className="library-header-spacer" />
                  <button
                    className="pill-button library-remove-selected"
                    disabled={!selected.length || busy}
                    onClick={() =>
                      setRemove(
                        rows.filter((item) => selected.includes(item.id)),
                      )
                    }
                  >
                    <Trash2 size={16} />
                    {t("Remove")}
                  </button>
                  <button
                    className="pill-button"
                    disabled={!visible.length}
                    onClick={() =>
                      setSelected(
                        selected.length === visible.length
                          ? []
                          : visible.map((item) => item.id),
                      )
                    }
                  >
                    {selected.length === visible.length && visible.length
                      ? t("Deselect all")
                      : t("Select all")}
                  </button>
                  <button
                    className="icon-button library-exit-selection"
                    aria-label={t("Exit selection")}
                    onClick={() => {
                      setSelecting(false);
                      setSelected([]);
                    }}
                  >
                    <X size={19} />
                  </button>
                </>
              ) : (
                <>
                  <div className="library-menu-anchor">
                    <h1>
                      {split ? (
                        <button
                          aria-label={t("Choose Library section")}
                          aria-haspopup="menu"
                          aria-expanded={navMenu}
                          onClick={() => setNavMenu((value) => !value)}
                        >
                          <span className="library-title-text">
                            {searching ? t("Search results") : t(config.label)}
                          </span>
                          <ChevronDown size={20} />
                        </button>
                      ) : (
                        <span className="library-title-text">
                          {searching ? t("Search results") : t(config.label)}
                        </span>
                      )}
                    </h1>
                    {navMenu && (
                      <div className="library-menu library-section-menu">
                        {searchField(16, true)}
                        {libraryViews.map((item) => navItem(item.id))}
                      </div>
                    )}
                  </div>
                  <div className="library-header-spacer" />
                  {browsing && (
                    <>
                      <button
                        className="pill-button"
                        onClick={() => {
                          setSelecting(true);
                          setItemMenu(undefined);
                        }}
                      >
                        {t("Select")}
                      </button>
                      <div className="library-menu-anchor">
                        <button
                          className="icon-button library-sort-button"
                          aria-label={t("Sort artifacts")}
                          aria-haspopup="menu"
                          aria-expanded={sortMenu}
                          onClick={() => setSortMenu((value) => !value)}
                        >
                          <ListFilter size={19} />
                        </button>
                        {sortMenu && (
                          <div
                            className="library-menu"
                            role="menu"
                            aria-label={t("Sort artifacts")}
                          >
                            {(
                              [
                                ["auto", "Last opened"],
                                ["date", "Last created"],
                                ["name", "Title"],
                              ] as const
                            ).map(([sort, label]) => (
                              <button
                                role="menuitemradio"
                                aria-checked={presentation.sort === sort}
                                key={sort}
                                onClick={() =>
                                  void action(async () => {
                                    const state = await service.preferences({
                                      sort,
                                    });
                                    if (live.current) {
                                      setPresentation(state);
                                      setSortMenu(false);
                                    }
                                  })
                                }
                              >
                                <Check
                                  size={15}
                                  style={{
                                    visibility:
                                      presentation.sort === sort
                                        ? "visible"
                                        : "hidden",
                                  }}
                                />
                                {t(label)}
                              </button>
                            ))}
                            <hr />
                            {(
                              [
                                ["grid", "View as grid", LayoutGrid],
                                ["list", "View as list", List],
                              ] as const
                            ).map(([layout, label, Icon]) => (
                              <button
                                role="menuitemradio"
                                aria-checked={presentation.layout === layout}
                                key={layout}
                                onClick={() =>
                                  void action(async () => {
                                    const state = await service.preferences({
                                      layout,
                                    });
                                    if (live.current) {
                                      setPresentation(state);
                                      setSortMenu(false);
                                    }
                                  })
                                }
                              >
                                <Icon size={16} />
                                {t(label)}
                                {presentation.layout === layout && (
                                  <Check size={14} />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {config.create && !searching && (
                    <button
                      className="pill-button library-create"
                      aria-label={t(config.create)}
                      onClick={() => onDraft(t(config.prompt!))}
                    >
                      <Plus size={20} />
                      <span>{t(config.create)}</span>
                    </button>
                  )}
                </>
              )}
            </header>
            <div className="library-content" aria-busy={!loaded || busy}>
              {!loaded ? (
                <Empty
                  title={
                    error ? t("Library could not load") : t("Loading Library…")
                  }
                />
              ) : !client.signedIn() ? (
                <Empty
                  title={t("Connect to view your Library")}
                  icon={<LibraryIcon size={28} />}
                >
                  <button className="pill-button" onClick={onConnect}>
                    {t("Connect to Ark MA")}
                  </button>
                </Empty>
              ) : view === "files" && !searching ? (
                <>
                  <p className="library-capability">
                    {t(
                      "These are your MA memory documents. Sandbox file browsing is not connected.",
                    )}
                  </p>
                  <div className="library-system-files">
                    {Object.values(identity.documents).map((document) => (
                      <button
                        key={document.name}
                        onClick={() => onDocument(document.name)}
                      >
                        <FileText size={20} />
                        <strong>{document.name}</strong>
                        <span>{dateLabel(document.updated_at ?? "")}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : !supported ? (
                <Empty
                  title={t(config.empty)}
                  icon={(() => {
                    const Icon = icons[view];
                    return <Icon size={28} strokeWidth={1.5} />;
                  })()}
                >
                  <p>
                    {t(
                      "MA media and executable artifact indexing are not connected in this Mac build. Creating starts an unsent chat draft; no output is invented.",
                    )}
                  </p>
                </Empty>
              ) : !visible.length ? (
                <Empty
                  title={
                    searching
                      ? t("No results for “{query}”", { query: query.trim() })
                      : t(config.empty)
                  }
                  icon={
                    searching ? (
                      <Search size={28} strokeWidth={1.5} />
                    ) : (
                      <LibraryIcon size={28} strokeWidth={1.5} />
                    )
                  }
                />
              ) : (
                <>
                  <p className="library-capability">
                    {t(
                      "Saved MA replies on this Mac. Removing an item keeps its cloud conversation.",
                    )}
                  </p>
                  {groups.map((group) => (
                    <section className="library-group" key={group.title}>
                      {group.title && <h2>{t(group.title)}</h2>}
                      <div className={`library-items ${presentation.layout}`}>
                        {group.items.map((item) => (
                          <article
                            key={item.id}
                            className={`library-card ${selected.includes(item.id) ? "selected" : ""}`}
                          >
                            <button
                              className="library-card-open"
                              aria-label={
                                selecting
                                  ? t("Select {title}", { title: item.title })
                                  : t("Open {title}", { title: item.title })
                              }
                              aria-pressed={
                                selecting
                                  ? selected.includes(item.id)
                                  : undefined
                              }
                              onClick={() =>
                                selecting ? toggleSelected(item.id) : open(item)
                              }
                            >
                              {presentation.layout === "grid" ? (
                                <div className="library-card-preview">
                                  <div>{item.text.slice(0, 1600)}</div>
                                </div>
                              ) : (
                                <FileText size={23} />
                              )}
                              <div className="library-card-footer">
                                <FileText size={18} />
                                <div>
                                  <strong>{item.title}</strong>
                                  <span>{dateLabel(item.created_at)}</span>
                                </div>
                              </div>
                            </button>
                            {selecting ? (
                              <span
                                className="library-selection-check"
                                aria-hidden="true"
                              >
                                {selected.includes(item.id) && (
                                  <Check size={14} />
                                )}
                              </span>
                            ) : (
                              <div className="library-menu-anchor library-item-menu">
                                <button
                                  className="icon-button"
                                  aria-label={t("Options for {title}", {
                                    title: item.title,
                                  })}
                                  aria-haspopup="menu"
                                  aria-expanded={itemMenu === item.id}
                                  onClick={() => {
                                    setSortMenu(false);
                                    setItemMenu((id) =>
                                      id === item.id ? undefined : item.id,
                                    );
                                  }}
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                                {itemMenu === item.id && itemActions(item)}
                              </div>
                            )}
                            {presentation.pinned.includes(item.id) && (
                              <Pin
                                className="library-pin-mark"
                                size={15}
                                aria-label={t("Pinned")}
                              />
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </>
              )}
            </div>
          </>
        )}
        {error && (
          <div className="library-error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label={t("Refresh Library")}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        )}
        {(undo?.length || notice) && (
          <div className="library-notice" role="status">
            <span>
              {undo?.length
                ? t("{count} removed from Library", { count: undo.length })
                : notice}
            </span>
            {undo?.length ? (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await service.restore(undo);
                    if (live.current) {
                      setUndo(undefined);
                      await refresh();
                    }
                  })
                }
              >
                {t("Undo")}
              </button>
            ) : null}
            <button
              className="icon-button"
              aria-label={t("Dismiss notification")}
              onClick={() => {
                setUndo(undefined);
                setNotice("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
      {remove && (
        <Modal
          title={t("Remove from Library?")}
          onClose={() => !busy && setRemove(undefined)}
        >
          <p>
            {t(
              "Remove {count} saved documents from this Mac? Their cloud conversations are kept. You can undo this while Library stays open.",
              { count: remove.length },
            )}
          </p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => setRemove(undefined)}
            >
              {t("Cancel")}
            </button>
            <button
              className="pill-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const removed = await service.remove(remove);
                  if (live.current) {
                    setRemove(undefined);
                    setUndo(removed.length ? removed : undefined);
                    if (!removed.length)
                      setNotice(
                        t(
                          "Nothing was removed. The saved copy changed on this Mac.",
                        ),
                      );
                    setSelected([]);
                    setSelecting(false);
                    await refresh();
                  }
                })
              }
            >
              {t("Remove")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
