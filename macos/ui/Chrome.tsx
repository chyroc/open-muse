import { t } from "../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  Lightbulb,
  MessageCircle,
  Search,
  Settings,
  X,
  createLucideIcon,
} from "lucide-react";
import { CompanionAvatar } from "../../src/ChatUI";
import type { Page } from "./model";
import { navLabel } from "./labels";

// The feed: a card resting on the page behind it.
export const FeedIcon = createLucideIcon("feed-cards", [
  [
    "rect",
    { x: "8", y: "3", width: "13", height: "18", rx: "2.5", key: "card" },
  ],
  [
    "path",
    {
      d: "M8 7H5.5A1.5 1.5 0 0 0 4 8.5v10A2.5 2.5 0 0 0 6.5 21H10",
      key: "page",
    },
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
  [
    "rect",
    { x: "3.5", y: "3.5", width: "17", height: "17", rx: "3", key: "box" },
  ],
  ["path", { d: "m8 12.5 2.8 2.8L16.5 9", key: "tick" }],
]);

// The side-by-side chat toggle: a window with a sidebar on its left, filled
// while the chat is open beside the page.
export function SplitChatIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open && (
        <path
          d="M6 4.5h3v15H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5z"
          fill="currentColor"
          stroke="none"
        />
      )}
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9 4.5v15" />
    </svg>
  );
}

// The rail's menu button: two long lines.
const MenuLinesIcon = createLucideIcon("menu-lines", [
  ["path", { d: "M4.5 9.5h15", key: "top" }],
  ["path", { d: "M4.5 14.5h15", key: "bottom" }],
]);

// The library: four shapes in a grid.
export const LibraryIcon = createLucideIcon("shape-grid", [
  ["path", { d: "M7 2.8 10.2 6 7 9.2 3.8 6z", key: "diamond" }],
  ["path", { d: "M17 3 20.5 9h-7z", key: "triangle" }],
  ["circle", { cx: "7", cy: "17", r: "3.3", key: "circle" }],
  [
    "rect",
    {
      x: "13.7",
      y: "13.7",
      width: "6.6",
      height: "6.6",
      rx: "1.5",
      key: "square",
    },
  ],
]);

// The companion, as on iPhone: the plush avatar that idles and, while it
// works, puts on headphones at its laptop.
export function Avatar({
  large = false,
  working = false,
}: {
  large?: boolean;
  working?: boolean;
}) {
  return (
    <span className={`desktop-avatar${large ? " large" : ""}`}>
      <CompanionAvatar alive working={working} />
    </span>
  );
}

// One rail entry's name and shortcut, shown at once beside it on hover.
function RailTip({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <span className="rail-tip" aria-hidden="true">
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
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
  const entry = (
    key: string,
    label: string,
    glyph: ReactNode,
    onClick: () => void,
    options: { current?: boolean; shortcut?: string; index: number },
  ) => (
    <button
      key={key}
      className="rail-item"
      aria-label={label}
      aria-current={options.current ? "page" : undefined}
      style={{ animationDelay: `${options.index * 30}ms` }}
      onClick={onClick}
    >
      <span className="rail-surface">{glyph}</span>
      <RailTip label={label} shortcut={options.shortcut} />
    </button>
  );
  const pages = [
    {
      id: "feed",
      label: t("Feed"),
      glyph: <FeedIcon size={24} strokeWidth={2} />,
    },
    {
      id: "ideas",
      label: navLabel("ideas"),
      glyph: <Lightbulb size={24} strokeWidth={2} />,
    },
    {
      id: "goals",
      label: t("Goals"),
      glyph: <GoalsIcon size={24} strokeWidth={2} />,
    },
    {
      id: "library",
      label: navLabel("library"),
      glyph: <LibraryIcon size={24} strokeWidth={2} />,
    },
  ] as const;
  return (
    <nav className="rail" aria-label={t("Main navigation")}>
      <div className="window-drag-space" />
      <div className="rail-companion-slot">
        {companion && (
          <button
            className="rail-companion"
            aria-label={t("Open the full chat with {name}", {
              name: companion.name,
            })}
            onClick={companion.onOpen}
          >
            <span className="companion-portrait">
              <Avatar />
            </span>
            <RailTip label={companion.name} />
          </button>
        )}
      </div>
      <div className="rail-primary">
        <div className="rail-items">
          {entry(
            "chat",
            navLabel("chat"),
            <ChatIcon size={24} strokeWidth={2} />,
            () => onNavigate("chat"),
            { current: page === "chat", shortcut: "⌘J", index: 0 },
          )}
          {entry(
            "search",
            t("Search"),
            <Search size={24} strokeWidth={2} />,
            onSearch,
            {
              shortcut: "⌘K",
              index: 1,
            },
          )}
          {pages.map(({ id, label, glyph }, i) =>
            entry(id, label, glyph, () => onNavigate(id), {
              current: page === id,
              index: i + 2,
            }),
          )}
        </div>
      </div>
      <div className="rail-menu-anchor">
        <button
          ref={trigger}
          className="rail-item rail-settings"
          aria-label={t("Settings")}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <span className="rail-surface">
            <MenuLinesIcon size={26} strokeWidth={1.6} />
          </span>
          {!menu && <RailTip label={t("Settings")} />}
        </button>
        {menu && (
          <div className="rail-menu" role="menu" ref={entries}>
            <button role="menuitem" onClick={() => choose(onShortcuts)}>
              <Keyboard size={16} />
              <span>{t("Keyboard shortcuts")}</span>
              <kbd>⌘/</kbd>
            </button>
            <hr />
            <button role="menuitem" onClick={() => choose(onSettings)}>
              <Settings size={16} />
              <span>{t("Settings")}</span>
              <kbd>⌘,</kbd>
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
