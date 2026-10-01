import { t } from "../shared/i18n";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronRight,
  History,
  Lightbulb,
  MessageCircle,
  Settings2,
  Shapes,
  Target,
  X,
  Blocks,
  PanelsTopLeft,
  SquareCheckBig,
} from "lucide-react";
import type { Goal, Session } from "../shared/types";
import { categories, templates } from "./content";
import { CategoryIcon } from "./components";

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
  grouped = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  // A gray sheet for white grouped lists, as in system settings.
  grouped?: boolean;
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
      className={grouped ? "muse-sheet grouped" : "muse-sheet"}
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
