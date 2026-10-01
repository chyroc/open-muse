import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Copy,
  Ellipsis,
  MessagesSquare,
  SmilePlus,
  Square,
  TextSelect,
  Volume2,
} from "lucide-react";
import { t } from "../../shared/i18n";
import { moods, type Mood } from "./reactions";

type Popup = "mood" | "more";

// The actions beside a bubble. The assistant's carry a mood tray first; the
// person's own mirror the order because they sit on the other side.
export function MessageActions({
  fromAssistant,
  mood,
  busy,
  onMood,
  onReply,
  onCopy,
  onSave,
  onSelect,
  speaking = false,
  onSpeak,
}: {
  fromAssistant: boolean;
  mood?: Mood;
  busy: boolean;
  onMood: (mood: Mood) => void;
  onReply: () => void;
  onCopy: () => void;
  onSave?: () => void;
  onSelect: () => void;
  speaking?: boolean;
  onSpeak?: () => void;
}) {
  const [open, setOpen] = useState<Popup>();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(".message-popup button")
      ?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        event.target instanceof Node &&
        root.current?.contains(event.target)
      )
        return;
      setOpen(undefined);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", close);
    };
  }, [open]);
  const toggle = (popup: Popup) =>
    setOpen((current) => (current === popup ? undefined : popup));
  const run = (action: () => void) => {
    setOpen(undefined);
    action();
  };
  const moodButton = (
    <button
      key="mood"
      aria-label={t("Leave a mood")}
      aria-haspopup="menu"
      aria-expanded={open === "mood"}
      onClick={() => toggle("mood")}
    >
      <SmilePlus size={14} />
    </button>
  );
  const reply = (
    <button key="reply" aria-label={t("Reply to message")} onClick={onReply}>
      <MessagesSquare size={14} />
    </button>
  );
  const copy = (
    <button key="copy" aria-label={t("Copy message")} onClick={onCopy}>
      <Copy size={14} />
    </button>
  );
  const more = (
    <button
      key="more"
      aria-label={t("More options")}
      aria-haspopup="menu"
      aria-expanded={open === "more"}
      onClick={() => toggle("more")}
    >
      <Ellipsis size={14} />
    </button>
  );
  return (
    <div className={`message-actions ${open ? "has-popup" : ""}`} ref={root}>
      {fromAssistant ? [moodButton, reply, copy, more] : [more, copy, reply]}
      {open === "mood" && (
        <div
          className="message-popup mood-tray"
          role="menu"
          aria-label={t("Leave a mood")}
        >
          {moods.map((value) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={mood === value}
              aria-label={value}
              onClick={() => run(() => onMood(value))}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      {open === "more" && (
        <div className="message-popup" role="menu">
          {onSave && (
            <button role="menuitem" disabled={busy} onClick={() => run(onSave)}>
              <BookmarkPlus size={15} />
              {t("Save reply to library")}
            </button>
          )}
          {onSpeak && (
            <button role="menuitem" onClick={() => run(onSpeak)}>
              {speaking ? <Square size={15} /> : <Volume2 size={15} />}
              {speaking ? t("Stop reading") : t("Read aloud")}
            </button>
          )}
          <button role="menuitem" onClick={() => run(onSelect)}>
            <TextSelect size={15} />
            {t("Select text")}
          </button>
        </div>
      )}
    </div>
  );
}
