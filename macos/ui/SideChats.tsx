import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleX,
  MessagesSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";
import { formatLocale, t } from "../../shared/i18n";
import { sideChatDrawerCopy } from "./labels";
import { panelOpacity } from "./PanelEdge";
import { focusOpenedMenu } from "./menuFocus";

// The side-chat panel docked next to the rail: its width, the range a drag on
// its edge can resize it to, and how far past the narrowest width a drag has
// to go before letting go closes it.
export const sideChatPanel = {
  width: 240,
  minWidth: 240,
  maxWidth: 420,
  collapseOvershoot: 64,
  clickSlop: 4,
  // The side-chats section opens and closes over this long.
  sectionMs: 200,
};

const keepVisibleKey = "muse.keep-chat-panel";
const widthKey = "muse.chat-panel-width";
const sectionKey = "muse.nav-section.side-chats";

// Device-local presentation choices, like the appearance setting: no
// credential and no cloud record.
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private storage can refuse writes; the choice then lasts this session.
  }
}

export const keepChatPanelVisible = () => read(keepVisibleKey) === "true";
export const setKeepChatPanelVisible = (value: boolean) =>
  write(keepVisibleKey, String(value));

export function storedChatPanelWidth() {
  const value = Number(read(widthKey));
  return Number.isFinite(value) && value > 0
    ? clampWidth(value)
    : sideChatPanel.width;
}
export const storeChatPanelWidth = (value: number) =>
  write(widthKey, String(Math.round(clampWidth(value))));

export const clampWidth = (value: number) =>
  Math.min(sideChatPanel.maxWidth, Math.max(sideChatPanel.minWidth, value));

// When a row last changed: "just now", minutes, hours, the weekday within a
// week, then the date.
export function compactTime(at: number, now = Date.now()) {
  const elapsed = Math.max(0, now - at);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return t("just now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const date = new Date(at);
  const locale = formatLocale();
  if (elapsed < 7 * 86_400_000)
    return date.toLocaleDateString(locale, { weekday: "short" });
  return date.getFullYear() === new Date(now).getFullYear()
    ? date.toLocaleDateString(locale, { month: "short", day: "numeric" })
    : date.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export type SideChatRow = { id: string; title: string; updatedAt?: number };

function Row({
  title,
  updatedAt,
  active,
  onClick,
  action,
  now,
}: {
  title: string;
  updatedAt?: number;
  active?: boolean;
  onClick: () => void;
  action?: ReactNode;
  now: number;
}) {
  return (
    <div className="side-chat-row">
      <button aria-current={active ? "page" : undefined} onClick={onClick}>
        <span className="side-chat-title" title={title}>
          {title}
        </span>
        {updatedAt !== undefined && updatedAt > 0 && (
          <span className="side-chat-time">{compactTime(updatedAt, now)}</span>
        )}
      </button>
      {action}
    </div>
  );
}

function NullState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="side-chats-null">
      {icon}
      <h3>{title}</h3>
      <p>{body}</p>
      {action && (
        <button className="pill-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function OptionsMenu({
  keepVisible,
  onKeepVisible,
  onShowArchived,
}: {
  keepVisible: boolean;
  onKeepVisible: (value: boolean) => void;
  onShowArchived: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    focusOpenedMenu(
      anchor.current?.querySelector<HTMLElement>('[role="menu"]'),
    );
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        trigger.current?.focus();
      } else if (
        event.target instanceof Node &&
        anchor.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    window.addEventListener("keydown", close, true);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);
  const label = t("Side chat options");
  return (
    <div className="side-chats-options" ref={anchor}>
      <button
        ref={trigger}
        className="side-chats-icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div
          className="side-chats-menu"
          role="menu"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [
              ...(anchor.current?.querySelectorAll<HTMLElement>(
                "[role^=menuitem]",
              ) ?? []),
            ];
            const at = items.indexOf(document.activeElement as HTMLElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(at + step + items.length) % items.length]?.focus();
          }}
        >
          <button
            role="menuitemcheckbox"
            aria-checked={keepVisible}
            onClick={() => {
              setOpen(false);
              onKeepVisible(!keepVisible);
            }}
          >
            <span className="side-chats-menu-icon">
              {keepVisible ? <Check size={18} /> : <PanelLeft size={18} />}
            </span>
            {t("Keep chat panel visible")}
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShowArchived();
            }}
          >
            <span className="side-chats-menu-icon">
              <Archive size={18} />
            </span>
            {t("Show archived chats")}
          </button>
        </div>
      )}
    </div>
  );
}

// The edge between the panel and the page: drag it to resize the panel, drag
// it well past the narrowest width or click it to close the panel.
function PanelEdge({
  width,
  onWidth,
  onClose,
}: {
  width: number;
  onWidth: (width: number, done: boolean) => void;
  onClose: () => void;
}) {
  const drag = useRef<{ x: number; width: number; moved: boolean }>(undefined);
  const next = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current!;
    return start.width + event.clientX - start.x;
  };
  return (
    <div
      className="side-chats-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize panel")}
      aria-valuenow={Math.round(width)}
      aria-valuemin={sideChatPanel.minWidth}
      aria-valuemax={sideChatPanel.maxWidth}
      title={t("Resize panel")}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width, moved: false };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        if (Math.abs(event.clientX - start.x) > sideChatPanel.clickSlop)
          start.moved = true;
        if (start.moved) onWidth(clampWidth(next(event)), false);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start) return;
        const wanted = next(event);
        drag.current = undefined;
        if (
          !start.moved ||
          wanted < sideChatPanel.minWidth - sideChatPanel.collapseOvershoot
        ) {
          onWidth(start.width, true);
          onClose();
        } else onWidth(clampWidth(wanted), true);
      }}
      onPointerCancel={() => {
        const start = drag.current;
        drag.current = undefined;
        if (start) onWidth(start.width, true);
      }}
    />
  );
}

// While side chats are pulled in from the rail, the panel shows only as wide
// as the pull and fades in over its first stretch.
export function PullFrame({
  pull,
  width,
  children,
}: {
  pull?: number;
  width: number;
  children: ReactNode;
}) {
  if (pull === undefined) return <>{children}</>;
  return (
    <div
      className="chat-drawer-pull"
      style={{ width: pull, opacity: panelOpacity(pull, width) }}
    >
      <div style={{ marginLeft: pull - width, width }}>{children}</div>
    </div>
  );
}

export function SideChatsPanel({
  chats,
  archivedChats,
  main,
  activeId,
  mainActive,
  drafting,
  query,
  onQuery,
  keepVisible,
  onKeepVisible,
  width,
  onWidth,
  onClose,
  onOpenMain,
  onOpenChat,
  onNewChat,
  onUnarchive,
}: {
  chats: SideChatRow[];
  archivedChats: SideChatRow[];
  main?: { updatedAt?: number };
  activeId?: string;
  mainActive: boolean;
  // A new side chat is being written and does not exist yet.
  drafting: boolean;
  query: string;
  onQuery: (value: string) => void;
  keepVisible: boolean;
  onKeepVisible: (value: boolean) => void;
  width: number;
  onWidth: (width: number, done: boolean) => void;
  onClose: () => void;
  onOpenMain: () => void;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  onUnarchive: (id: string) => void;
}) {
  const [view, setView] = useState<"threads" | "archived">("threads");
  const [expanded, setExpanded] = useState(() => read(sectionKey) !== "false");
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();
  useEffect(() => {
    if (view === "threads") search.current?.focus();
  }, [view]);
  const term = query.trim().toLocaleLowerCase();
  const matches = chats.filter((chat) =>
    chat.title.toLocaleLowerCase().includes(term),
  );
  const copy = sideChatDrawerCopy();
  const sorted = [...chats].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
  const empty = !chats.length && !drafting;
  let body: ReactNode;
  if (view === "archived")
    body = (
      <>
        <div className="side-chats-back">
          <button
            className="side-chats-round"
            aria-label={t("Back to chat list")}
            onClick={() => setView("threads")}
          >
            <ChevronLeft size={22} />
          </button>
        </div>
        {archivedChats.length ? (
          <section>
            <h2 className="side-chats-caption">{t("Archived chats")}</h2>
            <div className="side-chats-rows">
              {archivedChats.map((chat) => (
                <Row
                  key={chat.id}
                  title={chat.title}
                  updatedAt={chat.updatedAt}
                  now={now}
                  onClick={() => onOpenChat(chat.id)}
                  action={
                    <button
                      className="side-chat-action"
                      aria-label={t("Unarchive {title}", { title: chat.title })}
                      title={t("Unarchive")}
                      onClick={() => onUnarchive(chat.id)}
                    >
                      <ArchiveRestore size={16} />
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        ) : (
          <NullState
            icon={<Archive size={28} strokeWidth={1.5} />}
            title={t("No archived chats")}
            body={t("Side chats you archive will appear here.")}
          />
        )}
      </>
    );
  else if (term)
    body = matches.length ? (
      <div className="side-chats-rows">
        {matches.map((chat) => (
          <Row
            key={chat.id}
            title={chat.title}
            updatedAt={chat.updatedAt}
            now={now}
            active={chat.id === activeId}
            onClick={() => onOpenChat(chat.id)}
          />
        ))}
      </div>
    ) : (
      <p className="side-chats-none">{t("No results found")}</p>
    );
  else
    body = (
      <>
        {!empty && (
          <>
            <Row
              title={t("Main chat")}
              updatedAt={main?.updatedAt}
              now={now}
              active={mainActive}
              onClick={onOpenMain}
            />
            <section className="side-chats-section">
              <div className="side-chats-section-head">
                <h3>
                  <button
                    aria-expanded={expanded}
                    aria-controls="side-chats-items"
                    onClick={() => {
                      write(sectionKey, String(!expanded));
                      setExpanded(!expanded);
                    }}
                  >
                    <span>{t("Side chats")}</span>
                    <span className="side-chats-chevron" aria-hidden="true">
                      <ChevronDown size={18} />
                    </span>
                  </button>
                </h3>
                <button
                  className="side-chats-icon-button"
                  aria-label={t("New side chat")}
                  title={t("New side chat")}
                  aria-current={drafting ? "page" : undefined}
                  onClick={onNewChat}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div
                className="side-chats-collapse"
                data-expanded={expanded}
                inert={!expanded}
              >
                <div id="side-chats-items" className="side-chats-rows">
                  {sorted.map((chat) => (
                    <Row
                      key={chat.id}
                      title={chat.title}
                      updatedAt={chat.updatedAt}
                      now={now}
                      active={chat.id === activeId}
                      onClick={() => onOpenChat(chat.id)}
                    />
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
        {!chats.length && !drafting && (
          <NullState
            icon={<MessagesSquare size={28} strokeWidth={1.5} />}
            title={copy.title}
            body={copy.body}
            action={{ label: copy.action, onClick: onNewChat }}
          />
        )}
      </>
    );
  return (
    <aside
      className="chat-drawer"
      aria-label={t("Side chats")}
      style={{ width }}
    >
      {view === "threads" && (
        <header className="side-chats-header">
          <label className="side-chats-search">
            <Search size={20} aria-hidden="true" />
            <input
              ref={search}
              aria-label={t("Search side chats")}
              placeholder={t("Search")}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
            {query && (
              <button
                className="side-chats-clear"
                aria-label={t("Clear search")}
                onClick={() => {
                  onQuery("");
                  search.current?.focus();
                }}
              >
                <CircleX size={17} fill="currentColor" stroke="var(--bg)" />
              </button>
            )}
          </label>
          <OptionsMenu
            keepVisible={keepVisible}
            onKeepVisible={onKeepVisible}
            onShowArchived={() => {
              onQuery("");
              setView("archived");
            }}
          />
        </header>
      )}
      <div className="side-chats-scroll">{body}</div>
      <PanelEdge width={width} onWidth={onWidth} onClose={onClose} />
    </aside>
  );
}
