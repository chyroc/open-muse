import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { t } from "../shared/i18n";
import { quickReactions } from "../shared/emoji";
import { EmojiPicker } from "./EmojiPicker";
import { haptic } from "./haptics";
import "./message-menu.css";

export type MessageMenuAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

const menuWidth = 250;
const rowHeight = 44;
const gap = 12;
const margin = 16;
// The reaction bar: a 54pt glass capsule up to 370pt wide, 10pt above the
// lifted message.
const barHeight = 54;
const barGap = 10;
const barMaxWidth = 370;

// Long-pressing a message lifts it above a blurred backdrop, with a bar of
// quick reactions over it and a glass menu beside it, below when there is
// room and above otherwise. Tapping outside, choosing an action or a
// reaction, or Escape puts everything back.
export function MessageMenu({
  source,
  fromUser,
  actions,
  reaction,
  onReact,
  onClose,
}: {
  // The pressed bubble; a copy of it is lifted above the backdrop.
  source: HTMLElement;
  fromUser: boolean;
  actions: MessageMenuAction[];
  // The emoji already chosen for this message; choosing it again removes it.
  reaction?: string;
  onReact: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lifted = useRef<HTMLDivElement>(null);
  const [rect] = useState(() => source.getBoundingClientRect());
  useEffect(() => {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.querySelector(".bubble-options")?.remove();
    copy.querySelector(".bubble-reaction")?.remove();
    lifted.current?.replaceChildren(copy);
  }, [source]);
  const [closing, setClosing] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    haptic("medium");
    element.showModal();
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  const dismiss = (then?: () => void) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      onClose();
      then?.();
    }, 160);
  };
  const react = (emoji: string) => {
    haptic("light");
    dismiss(() => onReact(emoji === reaction ? null : emoji));
  };
  const height = window.innerHeight;
  const width = window.innerWidth;
  const menuHeight = actions.length * rowHeight;
  const ceiling = margin + 44 + barHeight + barGap;
  // Keep the lifted bubble on screen with the reactions above it, moving it
  // up so the menu fits below when the whole message can.
  const top = Math.max(
    ceiling,
    Math.min(rect.top, height - margin - menuHeight - gap - rect.height),
  );
  const below = top + Math.min(rect.height, height) + gap;
  const menuBelow = below + menuHeight <= height - margin;
  // A message too tall for the menu on either side keeps it at the bottom of
  // the screen, and the lifted copy is cut off above it.
  const menuAbove = !menuBelow && top - gap - menuHeight >= ceiling;
  const menuTop = menuBelow
    ? below
    : menuAbove
      ? top - gap - menuHeight
      : height - margin - menuHeight;
  // With the menu above, the reactions go above the menu.
  const barTop = (menuAbove ? menuTop : top) - barGap - barHeight;
  const barWidth = Math.min(barMaxWidth, width - margin * 2);
  const barLeft = fromUser
    ? Math.min(width - margin, rect.right) - barWidth
    : Math.max(margin, rect.left);
  const left = fromUser
    ? Math.max(margin, rect.right - menuWidth)
    : Math.max(margin, rect.left);
  return (
    <dialog
      ref={dialog}
      className={`message-menu${closing ? " closing" : ""}`}
      tabIndex={-1}
      aria-label={t("Message")}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <div
        ref={lifted}
        className={`message-menu-bubble${fromUser ? " from-user" : " from-assistant"}`}
        style={{
          top,
          left: rect.left,
          width: rect.width,
          maxHeight: Math.max(
            80,
            menuTop > top ? menuTop - gap - top : height - top - margin,
          ),
        }}
        onClick={() => dismiss()}
      />
      <div
        className="message-reactions"
        role="toolbar"
        aria-label={t("Reactions")}
        style={{
          top: barTop,
          left: barLeft,
          width: barWidth,
          transformOrigin: `${fromUser ? "100%" : "0"} 100%`,
        }}
      >
        <div className="message-reactions-row">
          {quickReactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={emoji === reaction ? "selected" : undefined}
              aria-pressed={emoji === reaction}
              onClick={() => react(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="message-reactions-more"
          aria-label={t("More reactions")}
          onClick={() => setPicking(true)}
        >
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>
      <div
        className="message-menu-actions"
        role="menu"
        style={{
          top: menuTop,
          left,
          width: menuWidth,
          transformOrigin: `${fromUser ? "100%" : "0"} ${menuTop > top ? "0" : "100%"}`,
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            role="menuitem"
            disabled={action.disabled}
            onClick={() => dismiss(action.onSelect)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      {picking && (
        <EmojiPicker
          selected={reaction}
          onPick={react}
          onClose={() => setPicking(false)}
        />
      )}
    </dialog>
  );
}
