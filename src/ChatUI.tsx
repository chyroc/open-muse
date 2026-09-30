import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Mic,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Square,
  SquarePen,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Session } from "../shared/types";
import type { ConversationIndex } from "./direct/conversations";
import { Sheet } from "./MusePages";

export function CompanionAvatar() {
  return (
    <span className="companion-avatar" aria-hidden="true">
      <span className="companion-body" />
      <span className="companion-face">
        <i />
        <i />
        <b />
      </span>
    </span>
  );
}

export function MessageBubble({
  children,
  label,
  onOptions,
}: {
  children: ReactNode;
  label: string;
  onOptions: () => void;
}) {
  const press = useRef<
    { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined
  >(undefined);
  const cancel = () => {
    clearTimeout(press.current?.timer);
    press.current = undefined;
  };
  useEffect(() => cancel, []);
  return (
    <article
      className="chat-bubble"
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        onOptions();
      }}
      onTouchStart={(event) => {
        cancel();
        if (
          event.touches.length !== 1 ||
          (event.target as Element).closest("a, button, input")
        )
          return;
        const { clientX: x, clientY: y } = event.touches[0];
        press.current = {
          x,
          y,
          timer: setTimeout(() => {
            press.current = undefined;
            onOptions();
          }, 500),
        };
      }}
      onTouchMove={(event) => {
        const touch = event.touches[0];
        if (
          !touch ||
          (press.current &&
            Math.hypot(
              touch.clientX - press.current.x,
              touch.clientY - press.current.y,
            ) > 10)
        )
          cancel();
      }}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
    >
      {children}
      <button className="bubble-options" aria-label={label} onClick={onOptions}>
        •••
      </button>
    </article>
  );
}

export function ChatHeader({
  onSidebar,
  onStatus,
  onMore,
  status,
  sideTitle,
  name = "Muse",
  feed = false,
  showSidebar = true,
  showMore = true,
  moreLabel,
}: {
  onSidebar: () => void;
  onStatus: () => void;
  onMore: () => void;
  status: string;
  sideTitle?: string;
  name?: string;
  feed?: boolean;
  showSidebar?: boolean;
  showMore?: boolean;
  moreLabel?: string;
}) {
  return (
    <header className="companion-header">
      {showSidebar && (
        <button
          className="glass-button header-left"
          aria-label="Open sidebar"
          onClick={onSidebar}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 8h18M3 16h18"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      <button
        className="companion-status"
        aria-label={`${name} status: ${status}`}
        onClick={onStatus}
      >
        <CompanionAvatar />
        <span className="companion-name">{name}</span>
      </button>
      {showMore && (
        <button
          className="glass-button header-right"
          aria-label={
            moreLabel ??
            (feed ? "Edit feed instructions" : "Conversation options")
          }
          onClick={onMore}
        >
          {feed ? (
            <SlidersHorizontal size={23} />
          ) : (
            <MoreHorizontal size={24} />
          )}
        </button>
      )}
      {sideTitle && <span className="side-chat-title">{sideTitle}</span>}
    </header>
  );
}

export function ChatComposer({
  value,
  setValue,
  onSend,
  onStop,
  running,
  busy,
  disabled,
  onActions,
  name = "Muse",
}: {
  value: string;
  setValue: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  onActions: () => void;
  name?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [dictationHint, setDictationHint] = useState(false);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 126)}px`;
  }, [value]);
  return (
    <>
      {dictationHint && (
        <div className="dictation-hint" role="status">
          Use your keyboard’s microphone to dictate.
          <button
            aria-label="Dismiss dictation hint"
            onClick={() => setDictationHint(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !busy && !disabled && !running) onSend();
        }}
      >
        <button
          type="button"
          className="composer-action"
          aria-label="Chat actions"
          onClick={onActions}
        >
          <Plus size={24} strokeWidth={1.5} />
        </button>
        <textarea
          ref={input}
          rows={1}
          aria-label={`Message ${name}`}
          placeholder="Message"
          maxLength={16000}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (value.trim() && !busy && !disabled && !running) onSend();
            }
          }}
        />
        {running ? (
          <button
            className="composer-action composer-send"
            type="button"
            aria-label="Stop response"
            disabled={busy}
            onClick={onStop}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : value.trim() || busy ? (
          <button
            className="composer-action composer-send"
            type="submit"
            aria-label="Send message"
            disabled={busy || disabled || !value.trim()}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUp size={21} />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="composer-action dictation-button"
            aria-label="Keyboard dictation"
            onClick={() => {
              setDictationHint(true);
              input.current?.focus();
            }}
          >
            <Mic size={21} strokeWidth={1.5} />
          </button>
        )}
      </form>
    </>
  );
}

export function ConversationSidebar({
  sessions,
  index,
  activeId,
  onClose,
  onNew,
  onArchive,
  busy,
  error,
  name = "Muse",
}: {
  sessions: Session[];
  index: ConversationIndex;
  activeId?: string;
  onClose: () => void;
  onNew: () => void;
  onArchive: (id: string, archived: boolean) => void;
  busy: boolean;
  error?: string;
  name?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);
  const rows = sessions
    .filter((session) => session.id !== index.mainId)
    .filter((session) => !index.entries[session.id]?.continuedBy)
    .filter(
      (session) => Boolean(index.entries[session.id]?.archived) === archived,
    )
    .filter((session) =>
      `${index.entries[session.id]?.title ?? session.title} ${session.preview ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  return (
    <dialog
      ref={dialog}
      className="conversation-sidebar"
      aria-label="Conversations"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>{name}</strong>
        <button
          className="glass-button"
          aria-label="Close sidebar"
          onClick={onClose}
        >
          <ArrowRight size={24} strokeWidth={1.5} />
        </button>
      </header>
      <a
        className={`main-chat-row ${!activeId || activeId === index.mainId ? "selected" : ""}`}
        href="#/"
        onClick={onClose}
      >
        Main chat
      </a>
      <div className="side-chat-section">
        <h2>{archived ? "Archived side chats" : "Side chats"}</h2>
        <button
          aria-label={archived ? "Show side chats" : "Show archived chats"}
          aria-pressed={archived}
          onClick={() => setArchived(!archived)}
        >
          <Archive size={20} />
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="side-chat-list">
        {rows.length ? (
          rows.map((session) => (
            <div
              key={session.id}
              className={`side-chat-row ${activeId === session.id ? "selected" : ""}`}
            >
              <a href={`#/task/${session.id}`} onClick={onClose}>
                <MessageCircle size={19} />
                <span>{index.entries[session.id]?.title ?? session.title}</span>
                {["running", "rescheduling"].includes(session.status) && (
                  <i aria-label="Running" />
                )}
              </a>
              <button
                disabled={busy}
                aria-label={`${archived ? "Restore" : "Archive"} ${index.entries[session.id]?.title ?? session.title}`}
                onClick={() => onArchive(session.id, !archived)}
              >
                {archived ? <ArrowLeft size={17} /> : <Archive size={17} />}
              </button>
            </div>
          ))
        ) : (
          <div className="side-chat-empty">
            <MessagesSquare size={29} strokeWidth={1.6} />
            <h2>
              {query
                ? "No matching chats"
                : archived
                  ? "No archived chats"
                  : "Start a side chat"}
            </h2>
            <p>
              {query
                ? "Try another search."
                : archived
                  ? "Archived chats stay available here."
                  : "Side chats are an optional way to organize conversations by topic."}
            </p>
          </div>
        )}
      </div>
      <footer>
        <a
          href="#/settings"
          className="glass-button"
          aria-label="Settings"
          onClick={onClose}
        >
          <Settings size={24} strokeWidth={1.5} />
        </a>
        <label className="sidebar-search">
          <Search size={20} />
          <input
            ref={search}
            aria-label="Search conversations"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="glass-button"
          aria-label="New side chat"
          disabled={busy}
          onClick={() => {
            onNew();
            onClose();
          }}
        >
          <SquarePen size={24} strokeWidth={1.5} />
        </button>
      </footer>
    </dialog>
  );
}

export function ChatActions({
  onClose,
  onNew,
  onExport,
  canExport,
  children,
}: {
  onClose: () => void;
  onNew: () => void;
  onExport: () => void;
  canExport: boolean;
  children?: ReactNode;
}) {
  return (
    <Sheet title="Conversation" onClose={onClose}>
      <div className="chat-action-list">
        <button
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <SquarePen size={22} />
          New side chat
        </button>
        <button
          disabled={!canExport}
          onClick={() => {
            onClose();
            onExport();
          }}
        >
          <ArrowDownToLine size={22} />
          Export conversation
        </button>
        {children}
      </div>
    </Sheet>
  );
}

export function ScrollToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="scroll-to-latest"
      aria-label="Scroll to latest message"
      onClick={onClick}
    >
      <ChevronDown size={18} />
    </button>
  );
}
