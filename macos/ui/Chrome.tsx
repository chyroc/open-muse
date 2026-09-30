import { t } from "../../shared/i18n";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  CheckSquare,
  Lightbulb,
  Menu,
  MessageCircle,
  Search,
  Shapes,
  X,
} from "lucide-react";
import type { Page } from "./model";

export function Avatar({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`desktop-avatar ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <span className="avatar-body" />
      <span className="avatar-arm left" />
      <span className="avatar-arm right" />
      <span className="avatar-face">
        <i />
        <i />
        <b />
      </span>
    </span>
  );
}

export function Rail({
  page,
  onNavigate,
  onSearch,
  onSettings,
  onStatus,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onSearch: () => void;
  onSettings: () => void;
  onStatus: () => void;
}) {
  const items = [
    { id: "chat", label: t("Chat"), Icon: MessageCircle },
    { id: "feed", label: t("Feed"), Icon: BookOpen },
    { id: "ideas", label: t("Ideas"), Icon: Lightbulb },
    { id: "goals", label: t("Goals"), Icon: CheckSquare },
    { id: "library", label: t("Library"), Icon: Shapes },
  ] as const;
  return (
    <nav className="rail" aria-label={t("Main navigation")}>
      <div className="window-drag-space" />
      <button
        className="rail-avatar"
        aria-label={t("Assistant status")}
        onClick={onStatus}
      >
        <Avatar />
      </button>
      <div className="rail-items">
        {items.map(({ id, label, Icon }, i) => (
          <div key={id}>
            <button
              title={label}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={25} strokeWidth={1.7} />
            </button>
            {i === 0 && (
              <button
                title={t("Search (⌘K)")}
                aria-label={t("Search")}
                onClick={onSearch}
              >
                <Search size={25} strokeWidth={1.7} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="rail-settings"
        title={t("Settings (⌘,)")}
        aria-label={t("Settings")}
        onClick={onSettings}
      >
        <Menu size={25} strokeWidth={1.5} />
      </button>
    </nav>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`desktop-dialog ${wide ? "wide" : ""} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={t("Close {title}", { title })}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ?? <MessageCircle size={28} strokeWidth={1.4} />}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ArchiveToggle({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: () => void;
}) {
  return (
    <button
      className="icon-button"
      title={
        archived ? t("Show active side chats") : t("Show archived side chats")
      }
      aria-label={
        archived ? t("Show active side chats") : t("Show archived side chats")
      }
      aria-pressed={archived}
      onClick={onChange}
    >
      <Archive size={17} />
    </button>
  );
}
