import { t } from "../shared/i18n";
import type { CompanionActivity } from "../shared/companion-activity";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { AttachmentSheet } from "./AttachmentSheet";
import { animateAway, animateIn, useDragToDismiss } from "./gesture";
import type { ConversationIndex } from "./direct/conversations";
import { Sheet } from "./MusePages";

// The companion, drawn in CSS. While it works it puts on headphones and
// types on a laptop.
export function CompanionAvatar({ working = false }: { working?: boolean }) {
  return (
    <span
      className={`companion-avatar${working ? " working" : ""}`}
      aria-hidden="true"
    >
      <span className="companion-body" />
      <span className="companion-face">
        <i />
        <i />
        <b />
      </span>
      <span className="companion-headphones" />
      <span className="companion-laptop" />
    </span>
  );
}

export function MessageBubble({
  children,
  label,
  onOptions,
  reaction,
}: {
  children: ReactNode;
  label: string;
  // Receives the bubble so a menu can lift a copy of it.
  onOptions: (bubble?: HTMLElement) => void;
  // An emoji this person reacted with, shown on the bubble's lower corner.
  reaction?: string;
}) {
  const bubble = useRef<HTMLElement>(null);
  const open = () => onOptions(bubble.current ?? undefined);
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
      ref={bubble}
      className={`chat-bubble${reaction ? " reacted" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        open();
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
            open();
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
      {reaction && (
        <span
          className="bubble-reaction"
          role="img"
          aria-label={t("Reaction: {emoji}", { emoji: reaction })}
        >
          {reaction}
        </span>
      )}
      <button className="bubble-options" aria-label={label} onClick={open}>
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
  activity,
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
  // What the companion is doing, shown under its name while not idle.
  activity?: CompanionActivity;
}) {
  return (
    <header className="companion-header">
      {showSidebar && (
        <button
          className="glass-button header-left"
          aria-label={t("Open sidebar")}
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
        aria-label={t("{name} status: {status}", { name, status: t(status) })}
        onClick={onStatus}
      >
        <CompanionAvatar working={Boolean(activity?.working)} />
        <span className="companion-name">
          <span className="companion-name-text">{name}</span>
          {activity && (
            <span
              key={activity.label}
              className={`companion-subtitle${activity.attention ? " attention" : ""}`}
            >
              {t(activity.label)}
            </span>
          )}
        </span>
      </button>
      {showMore && (
        <button
          className="glass-button header-right"
          aria-label={
            moreLabel ??
            (feed ? t("Edit feed instructions") : t("Conversation options"))
          }
          onClick={onMore}
        >
          {feed ? (
            <SlidersHorizontal size={20} />
          ) : (
            <MoreHorizontal size={22} strokeWidth={2.2} />
          )}
        </button>
      )}
      {/* A passing activity takes the title's place under the name. */}
      {sideTitle && !activity && (
        <span className="side-chat-title">{sideTitle}</span>
      )}
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
  onAttach,
  attachments,
  attachmentsReady = false,
  attachmentsPending = false,
  name = "Muse",
  newSideChat = false,
}: {
  value: string;
  setValue: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  onAttach: (files: File[]) => void;
  attachments?: ReactNode;
  attachmentsReady?: boolean;
  attachmentsPending?: boolean;
  name?: string;
  // A new side chat: its own placeholder, and the composer takes focus.
  newSideChat?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [attaching, setAttaching] = useState(false);
  useEffect(() => {
    if (newSideChat) input.current?.focus({ preventScroll: true });
  }, [newSideChat]);
  const [dictationHint, setDictationHint] = useState(false);
  const sendable =
    (Boolean(value.trim()) || attachmentsReady) && !attachmentsPending;
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
          {t("Use your keyboard’s microphone to dictate.")}
          <button
            aria-label={t("Dismiss dictation hint")}
            onClick={() => setDictationHint(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {attachments}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (sendable && !busy && !disabled && !running) onSend();
        }}
      >
        {attaching && (
          <AttachmentSheet
            onClose={() => setAttaching(false)}
            onFiles={onAttach}
          />
        )}
        <button
          type="button"
          className="composer-action"
          aria-label={t("Add attachment")}
          aria-haspopup="dialog"
          disabled={disabled || busy}
          onClick={() => setAttaching(true)}
        >
          <Plus size={24} strokeWidth={1.5} />
        </button>
        <textarea
          ref={input}
          rows={1}
          aria-label={t("Message {name}", { name })}
          placeholder={
            newSideChat ? t("Message in a new side chat") : t("Send a message")
          }
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
              if (sendable && !busy && !disabled && !running) onSend();
            }
          }}
        />
        {running ? (
          <button
            className="composer-action composer-send"
            type="button"
            aria-label={t("Stop response")}
            disabled={busy}
            onClick={onStop}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : value.trim() || attachmentsReady || attachmentsPending || busy ? (
          <button
            className="composer-action composer-send"
            type="submit"
            aria-label={t("Send message")}
            disabled={busy || disabled || !sendable}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUp size={20} strokeWidth={2.6} />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="composer-action dictation-button"
            aria-label={t("Keyboard dictation")}
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
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const closing = useRef(false);
  // The sidebar and the page move as one: opening pushes the page off to the
  // trailing edge, and closing slides both back; links navigate meanwhile.
  const root = () => document.documentElement;
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    root().classList.remove("sidebar-shown", "sidebar-dragging");
    root().style.removeProperty("--sidebar-progress");
    animateAway(panel.current, "x", -1, onClose, "push");
  };
  const drag = useDragToDismiss({
    target: panel,
    axis: "x",
    direction: -1,
    onDismiss: dismiss,
    onProgress: (progress, dragging) => {
      root().style.setProperty("--sidebar-progress", String(progress));
      root().classList.toggle("sidebar-dragging", dragging);
    },
  });
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    // Shown without modality: the page beneath stays focusable, so starting
    // a side chat can focus the composer within the tap and the keyboard
    // comes up. The sidebar covers the page and is layered above it.
    element.show();
    // Focus the panel, not its first button, so no focus ring flashes on open.
    element.focus({ preventScroll: true });
    root().classList.add("sidebar-stage", "sidebar-shown");
    animateIn(panel.current, "x", -1, "push");
    return () => {
      root().classList.remove(
        "sidebar-stage",
        "sidebar-shown",
        "sidebar-dragging",
      );
      root().style.removeProperty("--sidebar-progress");
      element.close();
      // Leave focus where typing has already started.
      if (
        focused instanceof HTMLElement &&
        !document.activeElement?.matches("textarea, input")
      )
        focused.focus();
    };
  }, []);
  const rows = sessions
    .filter((session) => session.id !== index.mainId && !session.generation)
    .filter((session) => !index.entries[session.id]?.continuedBy)
    .filter(
      (session) => Boolean(index.entries[session.id]?.archived) === archived,
    )
    .filter((session) =>
      `${index.entries[session.id]?.title ?? session.title} ${session.preview ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  // Rendered at the document root: the page it slides past is transformed,
  // and WebKit mis-places a modal dialog whose ancestor is transformed.
  const layer = (
    <dialog
      ref={dialog}
      className="conversation-sidebar"
      tabIndex={-1}
      aria-label={t("Conversations")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        dismiss();
      }}
    >
      <div ref={panel} className="sidebar-panel" {...drag}>
        <header>
          <strong>{name}</strong>
          <button
            className="glass-button"
            aria-label={t("Close sidebar")}
            onClick={dismiss}
          >
            <ArrowRight size={24} strokeWidth={1.5} />
          </button>
        </header>
        <a
          className={`main-chat-row ${!activeId || activeId === index.mainId ? "selected" : ""}`}
          href="#/"
          onClick={dismiss}
        >
          {t("Main chat")}
        </a>
        <div className="side-chat-section">
          <h2>{archived ? t("Archived side chats") : t("Side chats")}</h2>
          <button
            aria-label={
              archived ? t("Show side chats") : t("Show archived chats")
            }
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
                <a href={`#/task/${session.id}`} onClick={dismiss}>
                  <MessageCircle size={19} />
                  <span>
                    {index.entries[session.id]?.title ?? session.title}
                  </span>
                  {["running", "rescheduling"].includes(session.status) && (
                    <i aria-label={t("Running")} />
                  )}
                </a>
                <button
                  disabled={busy}
                  aria-label={`${archived ? t("Restore") : t("Archive")} ${index.entries[session.id]?.title ?? session.title}`}
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
                  ? t("No matching chats")
                  : archived
                    ? t("No archived chats")
                    : t("Start a side chat")}
              </h2>
              <p>
                {query
                  ? t("Try another search.")
                  : archived
                    ? t("Archived chats stay available here.")
                    : t(
                        "Side chats are an optional way to organize conversations by topic.",
                      )}
              </p>
            </div>
          )}
        </div>
        <footer>
          <a
            href="#/settings"
            className="glass-button"
            aria-label={t("Settings")}
          >
            <Settings size={24} strokeWidth={1.5} />
          </a>
          <label className="sidebar-search">
            <Search size={20} />
            <input
              ref={search}
              aria-label={t("Search conversations")}
              placeholder={t("Search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className="glass-button"
            aria-label={t("New side chat")}
            disabled={busy}
            onClick={() => {
              // Focus now, within the tap, so the keyboard comes up for the
              // new side chat's composer.
              document
                .querySelector<HTMLTextAreaElement>(".chat-composer textarea")
                ?.focus({ preventScroll: true });
              onNew();
              dismiss();
            }}
          >
            <SquarePen size={24} strokeWidth={1.5} />
          </button>
        </footer>
      </div>
    </dialog>
  );
  return typeof document === "undefined"
    ? layer
    : createPortal(layer, document.body);
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
    <Sheet title={t("Conversation")} onClose={onClose}>
      <div className="chat-action-list">
        <button
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <SquarePen size={22} />
          {t("New side chat")}
        </button>
        <button
          disabled={!canExport}
          onClick={() => {
            onClose();
            onExport();
          }}
        >
          <ArrowDownToLine size={22} />
          {t("Export conversation")}
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
      aria-label={t("Scroll to latest message")}
      onClick={onClick}
    >
      <ChevronDown size={18} />
    </button>
  );
}
