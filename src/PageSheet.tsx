import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../shared/i18n";
import { animateAway, useDragToDismiss } from "./gesture";
import "./page-sheet.css";

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
    animateAway(ref.current, "y", 1, () => closeRef.current());
  }
  const drag = useDragToDismiss({
    target: ref,
    axis: "y",
    direction: 1,
    onDismiss: dismiss,
  });

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
      <header className="page-sheet-header" {...drag}>
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
