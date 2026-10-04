import { t } from "../../shared/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CircleCheckIcon,
  CircleXIcon,
  EllipsisIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  WandIcon,
  type IconProps,
} from "./icons";

// Menu geometry shared by the row and dialog triggers.
export const ideaMenuMotion = {
  sideOffset: 6,
  collisionPadding: 8,
};

type MenuEntry =
  | {
      label: string;
      icon: ComponentType<IconProps>;
      onSelect: () => void;
      disabled?: boolean;
    }
  | "separator";

function ActionsMenu({
  label,
  appearance,
  entries,
}: {
  label: string;
  appearance: "row" | "bubble";
  entries: MenuEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    side: "top" | "bottom";
  }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((focus = false) => {
    setOpen(false);
    setPlace(undefined);
    if (focus) trigger.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = menu.current.offsetWidth;
    const height = menu.current.offsetHeight;
    const { sideOffset, collisionPadding } = ideaMenuMotion;
    const start = appearance === "row" ? anchor.right - width : anchor.left;
    const left = Math.max(
      collisionPadding,
      Math.min(start, window.innerWidth - width - collisionPadding),
    );
    const below = anchor.bottom + sideOffset;
    const above = anchor.top - sideOffset - height;
    const flip =
      below + height > window.innerHeight - collisionPadding &&
      above >= collisionPadding;
    setPlace({
      top: flip ? above : below,
      left,
      side: flip ? "top" : "bottom",
    });
  }, [open, appearance]);
  useEffect(() => {
    if (!place) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [place]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target))
        close();
    };
    const dismiss = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const resize = () => close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", resize);
    window.addEventListener("blur", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", resize);
    };
  }, [open, close]);
  const keys = (event: KeyboardEvent) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      items.at(next % items.length)?.focus();
    };
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close();
    else if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
  };
  return (
    <div className={`idea-actions idea-actions-${appearance}`}>
      <button
        ref={trigger}
        type="button"
        className={`idea-actions-trigger ${appearance === "row" ? "idea-borderless-button" : "idea-elevated-button"}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <EllipsisIcon width={15} height={15} />
      </button>
      {open && (
        <div
          ref={menu}
          className="idea-menu"
          role="menu"
          aria-label={label}
          data-side={place?.side}
          style={
            place
              ? { top: place.top, left: place.left }
              : { top: 0, left: 0, visibility: "hidden" }
          }
          onKeyDown={keys}
          onClick={(event) => event.stopPropagation()}
        >
          {entries.map((entry, index) =>
            entry === "separator" ? (
              <div
                key={`separator-${index}`}
                role="separator"
                className="idea-menu-separator"
              />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => {
                  close(true);
                  entry.onSelect();
                }}
              >
                <span className="idea-menu-icon" aria-hidden="true">
                  <entry.icon width={15} height={15} />
                </span>
                <span className="idea-menu-label">{entry.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** The "…" menu offered on each idea row and in the idea preview. */
export function IdeaActionsMenu({
  title,
  appearance,
  busy,
  onLetsDoIt,
  letsDoItDisabled = false,
  onMoreLikeThis,
  onNotInterested,
}: {
  title: string;
  appearance: "row" | "bubble";
  busy: boolean;
  onLetsDoIt?: () => void;
  letsDoItDisabled?: boolean;
  onMoreLikeThis: () => void;
  onNotInterested: () => void;
}) {
  const entries: MenuEntry[] = [];
  if (onLetsDoIt)
    entries.push(
      {
        label: t("Let's do it"),
        icon: WandIcon,
        onSelect: onLetsDoIt,
        disabled: letsDoItDisabled,
      },
      "separator",
    );
  entries.push(
    {
      label: t("More like this"),
      icon: ThumbUpIcon,
      onSelect: onMoreLikeThis,
      disabled: busy,
    },
    {
      label: t("Not interested"),
      icon: ThumbDownIcon,
      onSelect: onNotInterested,
      disabled: busy,
    },
  );
  return (
    <ActionsMenu
      label={t("More options for {title}", { title })}
      appearance={appearance}
      entries={entries}
    />
  );
}

export type IdeaToast = {
  id: number;
  tone: "success" | "error";
  text: string;
  action?: { label: string; onClick: () => void };
};

// Toasts stay for four seconds, pause while hovered, and leave with a short fade.
export const ideaToastTiming = { visible: 4000, exit: 200 };

export function useIdeaToast() {
  const [toast, setToast] = useState<IdeaToast & { leaving?: boolean }>();
  const sequence = useRef(0);
  const show = useCallback((next: Omit<IdeaToast, "id">) => {
    setToast({ ...next, id: ++sequence.current });
  }, []);
  const dismiss = useCallback((id: number) => {
    setToast((old) => (old?.id === id ? { ...old, leaving: true } : old));
  }, []);
  const remove = useCallback((id: number) => {
    setToast((old) => (old?.id === id ? undefined : old));
  }, []);
  return { toast, show, dismiss, remove };
}

export function IdeaToastView({
  toast,
  onDismiss,
  onRemove,
}: {
  toast?: IdeaToast & { leaving?: boolean };
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!toast || toast.leaving || paused) return;
    const timer = setTimeout(
      () => onDismiss(toast.id),
      ideaToastTiming.visible,
    );
    return () => clearTimeout(timer);
  }, [toast, paused, onDismiss]);
  useEffect(() => {
    if (!toast?.leaving) return;
    const timer = setTimeout(() => onRemove(toast.id), ideaToastTiming.exit);
    return () => clearTimeout(timer);
  }, [toast, onRemove]);
  const Icon = toast?.tone === "error" ? CircleXIcon : CircleCheckIcon;
  let body: ReactNode = null;
  if (toast)
    body = (
      <div
        key={toast.id}
        className="ideas-toast"
        data-leaving={toast.leaving ? "" : undefined}
        role={toast.tone === "error" ? "alert" : "status"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <span className="ideas-toast-icon" aria-hidden="true">
          <Icon width={20} height={20} />
        </span>
        <span className="ideas-toast-text">{toast.text}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    );
  return <div className="ideas-toast-layer">{body}</div>;
}
