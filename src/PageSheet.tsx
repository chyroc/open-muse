import { useEffect, useRef, type ReactNode, type PointerEvent } from "react";
import { t } from "../shared/i18n";
import "./page-sheet.css";

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Reads a numeric motion token from motion.css.
function motionToken(name: string, fallback: number) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const ms = Number.parseFloat(value);
  return Number.isFinite(ms) ? ms : fallback;
}

// A full-height page sheet with a large title and a close button. It slides
// up over whatever was on screen, follows a downward pull on its header while
// the finger moves, and springs back unless the pull or flick is far enough.
export function PageSheet({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const drag = useRef<{ y: number; time: number; dy: number; v: number }>(
    undefined,
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);

  function dismiss() {
    if (closing.current) return;
    closing.current = true;
    const dialog = ref.current;
    if (!dialog) return closeRef.current();
    const duration = motionToken("--motion-sheet-dismiss-duration", 340);
    dialog.classList.add("closing");
    dialog.style.transition = reducedMotion()
      ? `opacity ${duration}ms ease-out`
      : `transform ${duration}ms var(--motion-sheet-ease)`;
    if (reducedMotion()) dialog.style.opacity = "0";
    else dialog.style.transform = "translateY(100%)";
    window.setTimeout(() => closeRef.current(), duration);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (closing.current || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, time: event.timeStamp, dy: 0, v: 0 };
    ref.current!.style.transition = "none";
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state) return;
    const raw = event.clientY - state.y;
    // Upward pulls resist, as at the top of a system sheet.
    const dy = raw < 0 ? -Math.sqrt(-raw) * 2 : raw;
    const elapsed = Math.max(event.timeStamp - state.time, 1);
    state.v = (dy - state.dy) / elapsed;
    state.dy = dy;
    state.time = event.timeStamp;
    ref.current!.style.transform = `translateY(${dy}px)`;
  }

  function onPointerUp() {
    const state = drag.current;
    drag.current = undefined;
    if (!state) return;
    if (
      state.dy > motionToken("--motion-dismiss-distance", 120) ||
      state.v > motionToken("--motion-dismiss-velocity", 0.5)
    ) {
      dismiss();
      return;
    }
    const dialog = ref.current!;
    dialog.style.transition =
      "transform var(--motion-release-duration) var(--motion-release-ease)";
    dialog.style.transform = "";
  }

  return (
    <dialog
      ref={ref}
      className={`page-sheet ${className}`}
      tabIndex={-1}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === ref.current) dismiss();
      }}
    >
      <header
        className="page-sheet-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          className="page-sheet-close"
          aria-label={t("Close")}
          onClick={dismiss}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M2.5 2.5l15 15m0-15l-15 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h1>{title}</h1>
      </header>
      <div className="page-sheet-body">{children}</div>
    </dialog>
  );
}
