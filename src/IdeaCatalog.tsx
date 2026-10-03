import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Ellipsis, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  ideaCatalog,
  type CatalogIdea,
  type IdeaIncluded,
} from "../shared/idea-catalog";
import type { InspirationItem } from "../shared/inspiration";
import { quoteMessage } from "../shared/message-quote";
import { ideaIcon } from "./idea-icons";
import {
  animateAway,
  motionToken,
  reducedMotion,
  useDragToDismiss,
} from "./gesture";
import { PopoverMenu, type PopoverItem } from "./PopoverMenu";
import "./idea-catalog.css";

// An idea as the page shows it: catalog copy in the app's language, or an
// idea generated for this person.
export type ShownIdea = {
  id: string;
  title: string;
  // A catalog idea's title as authored, quoted when the idea is started.
  sourceTitle?: string;
  body: string;
  category: string;
  icon?: { src: string; width: number; height: number };
  emoji?: string;
  // Missing when there is nothing to list yet.
  included?: IdeaIncluded[];
  generated?: InspirationItem;
};

export function shownCatalogIdea(idea: CatalogIdea): ShownIdea {
  return {
    id: idea.id,
    title: t(idea.title),
    sourceTitle: idea.title,
    body: t(idea.body),
    category: t(idea.category),
    icon: ideaIcon(idea.id),
    included: idea.included?.map((row) => ({
      name: t(row.name),
      detail: t(row.detail),
    })),
  };
}

// The catalog in its order, in the app's language, without the ideas this
// device hid; a section whose ideas are all hidden goes too.
export function catalogSections(hidden: readonly string[] = []) {
  return ideaCatalog
    .map((section) => ({
      title: section.title && t(section.title),
      ideas: section.ideas
        .filter((idea) => !hidden.includes(idea.id))
        .map(shownCatalogIdea),
    }))
    .filter((section) => section.ideas.length);
}

export function shownGeneratedIdea(item: InspirationItem): ShownIdea {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    category: item.category,
    emoji: item.emoji || "💡",
    generated: item,
  };
}

// The message "Get started" sends to the main chat for a catalog idea: a
// short go-ahead that quotes the idea's title.
export function ideaStartMessage(
  idea: Pick<ShownIdea, "title" | "sourceTitle">,
) {
  return quoteMessage(idea.sourceTitle ?? idea.title, t("Let's get started!"));
}

// A magic wand with rays at its tip: solid in the menu, outlined on the
// "Get started" button.
function WandGlyph() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="50 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path
        d="M155 14v28M90 44l18 18M220 44l-18 18M62 103h30M90 168l18-18"
        strokeWidth="14"
      />
      <path d="M152 97l74 76" strokeWidth="42" />
      <path
        d="M150 94l15 16"
        stroke="#fff"
        strokeOpacity="0.9"
        strokeWidth="11"
      />
    </svg>
  );
}

function WandOutlineGlyph() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="80 40 190 190"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M165 52v26M112 77l17 17M218 82l-17 17M232 135h22M206 176l18 18"
        strokeWidth="13"
      />
      <path
        d="M102 214a14 14 0 0 1 0-20l66-66a14 14 0 0 1 20 20l-66 66a14 14 0 0 1-20 0z"
        strokeWidth="11"
      />
      <path d="M150 146l-12-12" strokeWidth="9" />
    </svg>
  );
}

export function ideaMenuItems({
  onStart,
  onLike,
  onHide,
}: {
  onStart: () => void;
  onLike: () => void;
  onHide: () => void;
}): PopoverItem[] {
  return [
    {
      kind: "item",
      label: t("Get started"),
      icon: <WandGlyph />,
      onSelect: onStart,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t("Show more like this"),
      icon: <ThumbsUp size={22} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onLike,
    },
    {
      kind: "item",
      label: t("Not interested"),
      icon: <ThumbsDown size={22} strokeWidth={1.8} aria-hidden="true" />,
      destructive: true,
      onSelect: onHide,
    },
  ];
}

function easing(name: string) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    "ease-out"
  );
}

// A row: the illustration in a 44pt square, then the title and up to five
// lines of the summary. A row that is leaving folds away, then reports gone.
export function IdeaRow({
  idea,
  onOpen,
  leaving = false,
  onGone,
}: {
  idea: ShownIdea;
  onOpen: () => void;
  leaving?: boolean;
  onGone?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const row = ref.current;
    if (!leaving || !row) return;
    if (typeof row.animate !== "function") {
      onGone?.();
      return;
    }
    const animation = row.animate(
      reducedMotion()
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { height: `${row.offsetHeight}px`, opacity: 1 },
            {
              height: "0px",
              opacity: 0,
              paddingTop: "0px",
              paddingBottom: "0px",
              borderBottomWidth: "0px",
            },
          ],
      {
        duration: motionToken("--motion-sheet-dismiss-duration", 300),
        easing: easing("--motion-sheet-ease"),
        fill: "forwards",
      },
    );
    animation.onfinish = () => onGone?.();
    return () => {
      animation.onfinish = null;
    };
  }, [leaving]);
  return (
    <button
      ref={ref}
      type="button"
      className={leaving ? "catalog-idea leaving" : "catalog-idea"}
      aria-label={`${idea.title}, ${idea.body}, ${idea.category}`}
      disabled={leaving}
      onClick={onOpen}
    >
      <span className="catalog-idea-icon" aria-hidden="true">
        {idea.icon ? (
          <img
            src={idea.icon.src}
            alt=""
            width={idea.icon.width}
            height={idea.icon.height}
            draggable={false}
          />
        ) : (
          idea.emoji
        )}
      </span>
      <span className="catalog-idea-text">
        <strong>{idea.title}</strong>
        <span className="catalog-idea-body">{idea.body}</span>
      </span>
    </button>
  );
}

function ClipboardGlyph() {
  return (
    <svg
      className="idea-included-glyph"
      width="20"
      height="24"
      viewBox="0 0 20 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 3.4H4A3 3 0 0 0 1 6.4v13.8a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6.4a3 3 0 0 0-3-3h-2" />
      <rect x="6" y="0.9" width="8" height="4.4" rx="1.5" />
      <path d="M6.2 12.4h7.6M6.2 17h7.6" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      className="idea-included-check"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="10" fill="currentColor" />
      <path
        d="M5.8 10.3l2.8 2.8 5.6-6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// What the sheet shows: the idea, what it sets up, and its two actions.
export function IdeaSheetBody({
  idea,
  menuOpen = false,
  starting = false,
  onStart,
  onMore,
  drag,
}: {
  idea: ShownIdea;
  menuOpen?: boolean;
  // Once started, the button holds and the checks gray out while it leaves.
  starting?: boolean;
  onStart: () => void;
  onMore: (button: HTMLButtonElement) => void;
  drag?: ReturnType<typeof useDragToDismiss>;
}) {
  return (
    <>
      <div className={`idea-sheet-scroll${starting ? " starting" : ""}`}>
        <header className="idea-sheet-head" {...drag}>
          <h2>{idea.title}</h2>
          <p>{idea.body}</p>
        </header>
        {idea.included?.length ? (
          <section className="idea-included" aria-label={t("What's included")}>
            <div className="idea-included-head">
              <h3>{t("What's included")}</h3>
              <ClipboardGlyph />
            </div>
            <ul>
              {idea.included.map((row) => (
                <li key={row.name + row.detail}>
                  <div>
                    <strong>{row.name}</strong>
                    <span>{row.detail}</span>
                  </div>
                  <CheckGlyph />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="idea-sheet-actions" {...drag}>
        <button
          type="button"
          className="idea-sheet-more"
          aria-label={t("More options")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMore(event.currentTarget)}
        >
          <Ellipsis size={19} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          className="idea-sheet-start"
          disabled={starting}
          onClick={onStart}
        >
          <WandOutlineGlyph />
          {t("Get started")}
        </button>
      </footer>
    </>
  );
}

// How long a started idea stays on screen before its sheet leaves, in ms.
const startHold = 360;

// The idea in a sheet floating up from the bottom. It follows a finger down
// and leaves past the dismiss distance, or springs back; the dimmed page
// behind it closes it too.
export function IdeaSheet({
  idea,
  onClose,
  onStart,
  onLike,
  onHide,
}: {
  idea: ShownIdea;
  onClose: () => void;
  onStart: () => void;
  onLike: () => void;
  onHide: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const [menu, setMenu] = useState<{ left: number; bottom: number }>();
  const [starting, setStarting] = useState(false);
  // Shows the idea as started for a moment, then leaves and starts it.
  const start = () => {
    if (closing.current || starting) return;
    setStarting(true);
    window.setTimeout(
      () => dismiss(onStart),
      reducedMotion() ? 120 : startHold,
    );
  };
  // Leaves, then reports closed and runs what was chosen.
  const dismiss = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    animateAway(ref.current, "y", 1, () => {
      onClose();
      then?.();
    });
  };
  const drag = useDragToDismiss({
    target: ref,
    axis: "y",
    direction: 1,
    onDismiss: () => dismiss(),
  });
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <>
      <dialog
        ref={ref}
        className="muse-sheet idea-sheet"
        tabIndex={-1}
        aria-label={idea.title}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClick={(event) => {
          if (event.target === ref.current) dismiss();
        }}
      >
        <IdeaSheetBody
          idea={idea}
          drag={drag}
          menuOpen={Boolean(menu)}
          starting={starting}
          onStart={start}
          onMore={(button) => {
            const rect = button.getBoundingClientRect();
            // The menu grows up and out of the button, covering it.
            setMenu({
              left: rect.left - 1,
              bottom: window.innerHeight - rect.bottom + 10,
            });
          }}
        />
      </dialog>
      {menu && (
        <PopoverMenu
          label={t("Idea options")}
          className="idea-menu"
          placement={{
            top: "auto",
            right: "auto",
            left: menu.left,
            bottom: menu.bottom,
          }}
          items={ideaMenuItems({
            onStart: start,
            onLike: () => dismiss(onLike),
            onHide: () => dismiss(onHide),
          })}
          onClose={() => setMenu(undefined)}
        />
      )}
    </>
  );
}
