import { t } from "../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Keyboard,
  Lightbulb,
  Menu,
  MessageCircle,
  Search,
  Settings,
  X,
  createLucideIcon,
} from "lucide-react";
import type { Page } from "./model";
import { navLabel } from "./labels";

// The feed: a card resting on the page behind it.
export const FeedIcon = createLucideIcon("feed-cards", [
  ["rect", { x: "8", y: "3", width: "13", height: "18", rx: "2.5", key: "card" }],
  [
    "path",
    { d: "M8 7H5.5A1.5 1.5 0 0 0 4 8.5v10A2.5 2.5 0 0 0 6.5 21H10", key: "page" },
  ],
  ["path", { d: "M12 8h5", key: "title" }],
  ["path", { d: "M12 12h5", key: "line" }],
]);

// A wide speech bubble with its tail at the lower left.
export const ChatIcon = createLucideIcon("chat-bubble", [
  [
    "path",
    {
      d: "M12 4.5c4.97 0 9 3.13 9 7s-4.03 7-9 7c-1.13 0-2.2-.16-3.2-.46L4 19.5l1.25-3.66C3.85 14.6 3 13.12 3 11.5c0-3.87 4.03-7 9-7z",
      key: "bubble",
    },
  ],
]);

// Goals: a box with a full-size tick.
export const GoalsIcon = createLucideIcon("goal-box", [
  ["rect", { x: "3.5", y: "3.5", width: "17", height: "17", rx: "3", key: "box" }],
  ["path", { d: "m8 12.5 2.8 2.8L16.5 9", key: "tick" }],
]);

// The library: four shapes in a grid.
export const LibraryIcon = createLucideIcon("shape-grid", [
  ["path", { d: "M7 2.8 10.2 6 7 9.2 3.8 6z", key: "diamond" }],
  ["path", { d: "M17 3 20.5 9h-7z", key: "triangle" }],
  ["circle", { cx: "7", cy: "17", r: "3.3", key: "circle" }],
  ["rect", { x: "13.7", y: "13.7", width: "6.6", height: "6.6", rx: "1.5", key: "square" }],
]);

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
  companion,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onSearch: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  // Away from the chat, the companion waits at the top of the rail and opens
  // the full chat.
  companion?: { name: string; onOpen: () => void };
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
    { id: "chat", label: navLabel("chat"), Icon: ChatIcon },
    { id: "feed", label: t("Feed"), Icon: FeedIcon },
    { id: "ideas", label: navLabel("ideas"), Icon: Lightbulb },
    { id: "goals", label: t("Goals"), Icon: GoalsIcon },
    { id: "library", label: navLabel("library"), Icon: LibraryIcon },
  ] as const;
  return (
    <nav className="rail" aria-label={t("Main navigation")}>
      <div className="window-drag-space" />
      {companion && (
        <button
          className="rail-companion"
          title={t("Open the full chat with {name}", { name: companion.name })}
          aria-label={t("Open the full chat with {name}", {
            name: companion.name,
          })}
          onClick={companion.onOpen}
        >
          <span className="companion-face">
            <Avatar />
          </span>
        </button>
      )}
      <div className="rail-items">
        {items.map(({ id, label, Icon }, i) => (
          <div key={id}>
            <button
              title={label}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={24} strokeWidth={2} />
            </button>
            {i === 0 && (
              <button
                title={t("Search (⌘K)")}
                aria-label={t("Search")}
                onClick={onSearch}
              >
                <Search size={24} strokeWidth={2} />
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
