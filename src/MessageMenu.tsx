import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../shared/i18n";
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

// Long-pressing a message lifts it above a blurred backdrop and opens a glass
// menu beside it, below when there is room and above otherwise. Tapping
// outside, choosing an action, or Escape puts everything back.
export function MessageMenu({
  source,
  fromUser,
  actions,
  onClose,
}: {
  // The pressed bubble; a copy of it is lifted above the backdrop.
  source: HTMLElement;
  fromUser: boolean;
  actions: MessageMenuAction[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lifted = useRef<HTMLDivElement>(null);
  const [rect] = useState(() => source.getBoundingClientRect());
  useEffect(() => {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.querySelector(".bubble-options")?.remove();
    lifted.current?.replaceChildren(copy);
  }, [source]);
  const [closing, setClosing] = useState(false);
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
  const height = window.innerHeight;
  const menuHeight = actions.length * rowHeight;
  // Keep the lifted bubble on screen, leaving room for the menu if possible.
  const top = Math.max(
    margin + 44,
    Math.min(rect.top, height - margin - menuHeight - gap - 80),
  );
  const below = top + Math.min(rect.height, height) + gap;
  const menuTop =
    below + menuHeight <= height - margin
      ? below
      : Math.max(margin + 44, top - gap - menuHeight);
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
    </dialog>
  );
}
