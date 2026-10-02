import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { t } from "../shared/i18n";
import { animateAway, useDragToDismiss } from "./gesture";
import "./page-sheet.css";

// The page sheet a sheet is opened from, if any; sheets opened inside it are
// pushed as pages within it instead of stacking another sheet.
const PageSheetHost = createContext<HTMLElement | null>(null);

export function usePageSheetHost() {
  return useContext(PageSheetHost);
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
  const [host, setHost] = useState<HTMLElement | null>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    setHost(dialog);
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
        // Escape goes back from a pushed page before closing the sheet.
        const pushed = ref.current?.querySelectorAll<HTMLButtonElement>(
          ".pushed-page-header button",
        );
        if (pushed?.length) pushed[pushed.length - 1].click();
        else dismiss();
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
      <div className="page-sheet-body">
        <PageSheetHost.Provider value={host}>{children}</PageSheetHost.Provider>
      </div>
    </dialog>
  );
}

// A page pushed within a page sheet: it slides in from the trailing edge over
// the sheet while the page beneath shifts back, has a back button and a
// centered title, and follows a rightward drag back as system navigation does.
export function PushedPage({
  host,
  title,
  onClose,
  children,
}: {
  host: HTMLElement;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const focused = document.activeElement;
    back.current?.focus({ preventScroll: true });
    return () => {
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  function dismiss() {
    if (closing.current) return;
    closing.current = true;
    animateAway(ref.current, "x", 1, () => closeRef.current());
  }
  const drag = useDragToDismiss({
    target: ref,
    axis: "x",
    direction: 1,
    onDismiss: dismiss,
  });
  return createPortal(
    <section
      ref={ref}
      className="pushed-page"
      role="dialog"
      aria-label={title}
      {...drag}
    >
      <header className="pushed-page-header">
        <button
          ref={back}
          className="page-sheet-close"
          aria-label={t("Back")}
          onClick={dismiss}
        >
          <ChevronLeft size={24} strokeWidth={2.4} />
        </button>
        <h2>{title}</h2>
      </header>
      <div className="pushed-page-body">{children}</div>
    </section>,
    host,
  );
}
