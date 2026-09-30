import { t } from "../shared/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronRight,
  FileText,
  History,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Search,
  Settings2,
  Shapes,
  Target,
  X,
  Blocks,
  PanelsTopLeft,
  SquareCheckBig,
} from "lucide-react";
import type { Client } from "./api";
import type { Goal, LibraryItem, Session } from "../shared/types";
import { categories, templates } from "./content";
import { CategoryIcon, dateLabel, Markdown } from "./components";
import { exportText } from "./platform";

export const primaryNavigation = [
  { id: "home", path: "/", label: t("Chat"), icon: MessageCircle },
  { id: "feed", path: "/feed", label: t("Feed"), icon: PanelsTopLeft },
  { id: "discover", path: "/discover", label: t("Ideas"), icon: Lightbulb },
  { id: "goals", path: "/goals", label: t("Goals"), icon: SquareCheckBig },
  { id: "library", path: "/library", label: t("Library"), icon: Shapes },
] as const;

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      className="muse-sheet"
      tabIndex={-1}
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-grip" aria-hidden="true" />
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("Close")}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function MoreMenu({
  sessions,
  onClose,
}: {
  sessions: Session[];
  onClose: () => void;
}) {
  return (
    <Sheet title={t("My Space")} onClose={onClose}>
      <nav className="more-links" aria-label={t("More")}>
        <a href="#/tasks" onClick={onClose}>
          <History />
          {t("All conversations")}
          <ChevronRight />
        </a>
        <a href="#/settings" onClick={onClose}>
          <Settings2 />
          {t("Settings & connections")}
          <ChevronRight />
        </a>
        <a href="#/studio" onClick={onClose}>
          <Blocks />
          MA Studio
          <ChevronRight />
        </a>
      </nav>
      <h3 className="list-caption">{t("Recent conversations")}</h3>
      <div className="more-recents">
        {sessions.slice(0, 8).map((s) => (
          <a key={s.id} href={`#/task/${s.id}`} onClick={onClose}>
            <MessageCircle size={19} />
            <span>{s.title}</span>
          </a>
        ))}
      </div>
      {!sessions.length && (
        <p className="muted">
          {t("No conversations yet. Start with a sentence.")}
        </p>
      )}
    </Sheet>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="muse-page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function ChatWelcome({
  composer,
  sessions,
  onTemplate,
  goal,
  onClearGoal,
}: {
  composer: ReactNode;
  sessions: Session[];
  onTemplate: (t: (typeof templates)[number]) => void;
  goal?: Goal;
  onClearGoal: () => void;
}) {
  return (
    <div className="chat-welcome">
      <div className="welcome-space">
        <span className="welcome-wordmark">muse</span>
        <h1>{t("What's on your mind?")}</h1>
        <p>{t("Tell Muse what you want to do.")}</p>
      </div>
      <div className="welcome-input">
        {goal && (
          <div className="goal-context">
            <Target size={16} />
            <span>{goal.title}</span>
            <button
              className="icon-button"
              aria-label={t("Unlink goal")}
              onClick={onClearGoal}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="prompt-chips">
          {templates.slice(0, 3).map((t) => (
            <button key={t.id} onClick={() => onTemplate(t)}>
              <CategoryIcon category={t.category} size={17} />
              {categories[t.category]}
            </button>
          ))}
        </div>
        {composer}
        <div className="welcome-footer">
          <a href="#/tasks">
            <History size={15} />
            {sessions.length
              ? t("View {count} conversations", { count: sessions.length })
              : t("Conversation history")}
          </a>
          <span>{t("AI-generated content may be inaccurate")}</span>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {t("Loading…")}
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="muse-empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return error ? (
    <div className="inline-error" role="alert">
      {error}
      {retry && <button onClick={retry}>{t("Retry")}</button>}
    </div>
  ) : null;
}

export function LibraryPage({ client }: { client: Client }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibraryItem>();
  const [exporting, setExporting] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await client.library()).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = items.filter((item) =>
    `${item.title}\n${item.text}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="muse-page">
      <PageHeader
        title={t("Library")}
        description={t("Save useful replies and come back to them anytime.")}
      />
      <label className="library-search">
        <Search size={19} />
        <input
          aria-label={t("Search Library")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search Library")}
        />
      </label>
      <div className="library-section">
        <FileText size={18} />
        <strong>{t("Saved replies")}</strong>
        <span>{items.length}</span>
      </div>
      <ErrorNotice error={error} retry={() => void reload()} />
      {loading ? (
        <Loading />
      ) : error && !items.length ? null : !visible.length ? (
        <Empty
          icon={<Shapes size={30} />}
          title={
            query ? t("No matching items") : t("Keep content worth saving")
          }
          description={
            query
              ? t("Try other keywords.")
              : t("Tap Save on a conversation reply to keep it here.")
          }
        />
      ) : (
        <div className="library-grid">
          {visible.map((item) => (
            <button
              className="library-card"
              key={item.id}
              onClick={() => setSelected(item)}
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
      )}
      {selected && (
        <Sheet title={selected.title} onClose={() => setSelected(undefined)}>
          <Markdown text={selected.text} />
          <div className="library-detail-actions">
            <a
              className="button secondary"
              href={`#/task/${selected.session_id}`}
              onClick={() => setSelected(undefined)}
            >
              {t("View source conversation")}
              <ArrowRight size={16} />
            </a>
            <button
              className="icon-button"
              aria-label={t("Export item")}
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportText(`${selected.title}.md`, selected.text);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <ArrowDownToLine size={21} />
            </button>
          </div>
          <ErrorNotice error={error} />
        </Sheet>
      )}
    </section>
  );
}
