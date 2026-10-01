import { t } from "../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  Keyboard,
  CheckSquare,
  Lightbulb,
  Menu,
  MessageCircle,
  Search,
  Settings,
  Shapes,
  X,
} from "lucide-react";
import type { Page } from "./model";
import { navLabel } from "./labels";

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
  onShortcuts,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onSearch: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const entries = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    entries.current?.querySelector("button")?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        trigger.current?.focus();
      } else if (
        event.target instanceof Element &&
        event.target.closest(".rail-menu-anchor")
      )
        return;
      setMenu(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", close);
    };
  }, [menu]);
  const choose = (action: () => void) => {
    setMenu(false);
    action();
  };
  const items = [
    { id: "chat", label: navLabel("chat"), Icon: MessageCircle },
    { id: "feed", label: t("Feed"), Icon: BookOpen },
    { id: "ideas", label: navLabel("ideas"), Icon: Lightbulb },
    { id: "goals", label: t("Goals"), Icon: CheckSquare },
    { id: "library", label: navLabel("library"), Icon: Shapes },
  ] as const;
  return (
    <nav className="rail" aria-label={t("Main navigation")}>
      <div className="window-drag-space" />
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
      <div className="rail-menu-anchor">
        <button
          ref={trigger}
          className="rail-settings"
          title={t("Settings (⌘,)")}
          aria-label={t("Settings")}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <Menu size={25} strokeWidth={1.5} />
        </button>
        {menu && (
          <div className="rail-menu" role="menu" ref={entries}>
            <button role="menuitem" onClick={() => choose(onSettings)}>
              <Settings size={16} />
              <span>{t("Settings…")}</span>
              <kbd>⌘,</kbd>
            </button>
            <button role="menuitem" onClick={() => choose(onShortcuts)}>
              <Keyboard size={16} />
              <span>{t("Keyboard shortcuts")}</span>
              <kbd>⌘/</kbd>
            </button>
          </div>
        )}
      </div>
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
