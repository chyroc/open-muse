import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { t } from "../shared/i18n";
import { emojiCategories } from "../shared/emoji";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./emoji-picker.css";

// A floating sheet of every offered emoji: a search field, a row of category
// shortcuts that follows the scroll, and a grid per category. Searching
// matches each emoji's name in English and in the current language.
export function EmojiPicker({
  selected,
  onPick,
  onClose,
}: {
  selected?: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const dismiss = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    animateAway(dialog.current, "y", 1, () => {
      onClose();
      then?.();
    });
  };
  const drag = useDragToDismiss({
    target: dialog,
    axis: "y",
    direction: 1,
    onDismiss: () => dismiss(),
  });
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return undefined;
    return emojiCategories
      .flatMap((category) => category.emoji)
      .filter(
        ([emoji, name]) =>
          emoji === needle ||
          name.includes(needle) ||
          t(name).toLocaleLowerCase().includes(needle),
      );
  }, [query]);
  const pick = (emoji: string) => dismiss(() => onPick(emoji));
  const cell = ([emoji, name]: readonly [string, string]) => (
    <button
      key={emoji}
      type="button"
      className={emoji === selected ? "selected" : undefined}
      aria-label={t(name)}
      aria-pressed={emoji === selected}
      onClick={() => pick(emoji)}
    >
      {emoji}
    </button>
  );
  // The shortcut row highlights the category at the top of the scroll.
  const follow = () => {
    const scroller = body.current;
    if (!scroller || matches) return;
    const sections = [
      ...scroller.querySelectorAll<HTMLElement>(".emoji-section"),
    ];
    let index = 0;
    sections.forEach((section, position) => {
      if (section.offsetTop - scroller.offsetTop <= scroller.scrollTop + 8)
        index = position;
    });
    setCurrent(index);
  };
  const jump = (index: number) => {
    setQuery("");
    setCurrent(index);
    requestAnimationFrame(() => {
      const scroller = body.current;
      const section =
        scroller?.querySelectorAll<HTMLElement>(".emoji-section")[index];
      if (scroller && section)
        scroller.scrollTo({
          top: section.offsetTop - scroller.offsetTop,
          behavior: "smooth",
        });
    });
  };
  return (
    <dialog
      ref={dialog}
      className="emoji-picker"
      tabIndex={-1}
      aria-label={t("Mood")}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <ContinuousSurface />
      <div className="emoji-picker-top" {...drag}>
        <div className="emoji-picker-grip" aria-hidden="true" />
        <h2>{t("Mood")}</h2>
      </div>
      <label className="emoji-search">
        <Search size={18} strokeWidth={2.2} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t("Search emoji")}
          aria-label={t("Search emoji")}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav className="emoji-categories">
        {emojiCategories.map((category, index) => (
          <button
            key={category.label}
            type="button"
            className={!matches && index === current ? "current" : undefined}
            aria-label={t(category.label)}
            aria-current={!matches && index === current ? "true" : undefined}
            onClick={() => jump(index)}
          >
            {category.icon}
          </button>
        ))}
      </nav>
      <div ref={body} className="emoji-picker-body" onScroll={follow}>
        {matches ? (
          matches.length ? (
            <div className="emoji-grid">{matches.map(cell)}</div>
          ) : (
            <p className="emoji-empty">{t("No matching emoji")}</p>
          )
        ) : (
          emojiCategories.map((category) => (
            <section key={category.label} className="emoji-section">
              <h3>{t(category.label)}</h3>
              <div className="emoji-grid">{category.emoji.map(cell)}</div>
            </section>
          ))
        )}
      </div>
    </dialog>
  );
}
