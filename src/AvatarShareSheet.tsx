import { useEffect, useRef, useState } from "react";
import { Copy, MessageCircle, Share, X } from "lucide-react";
import { t } from "../shared/i18n";
import { CompanionAvatar } from "./ChatUI";
import { animateAway, useDragToDismiss } from "./gesture";
import { shareText } from "./platform";
import "./avatar-share.css";

// Each card pairs a backdrop with a pose; the greeting takes its color.
const cards = [
  { tone: "rose", working: false },
  { tone: "peach", working: true },
  { tone: "butter", working: false },
  { tone: "mint", working: false },
] as const;

// Cards that introduce the companion, to pass on to friends: swipe between
// styles, then share the greeting.
export function AvatarShareSheet({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);
  const greeting = t(
    "Hi, I’m {name}, a personal AI agent. Join Open Muse and create your own agent.",
    { name },
  );
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    dialog.current?.classList.add("closing");
    animateAway(dialog.current, "y", 1, onClose);
  };
  const drag = useDragToDismiss({
    target: dialog,
    axis: "y",
    direction: 1,
    onDismiss: dismiss,
  });
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="avatar-share"
      tabIndex={-1}
      aria-label={t("Share my avatar")}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header {...drag}>
        <h2>{t("Share my avatar")}</h2>
        <button
          type="button"
          className="activity-detail-close"
          aria-label={t("Close")}
          onClick={dismiss}
        >
          <X size={20} strokeWidth={2.2} />
        </button>
      </header>
      <div
        ref={track}
        className="avatar-share-cards"
        onScroll={(event) => {
          const element = event.currentTarget;
          setPage(Math.round(element.scrollLeft / element.clientWidth));
        }}
      >
        {cards.map((card, index) => (
          <figure
            key={card.tone}
            className={`avatar-share-card ${card.tone}`}
            aria-label={t("Style {number}", { number: index + 1 })}
          >
            <div className="avatar-share-photo">
              <CompanionAvatar working={card.working} />
            </div>
            <figcaption>
              <span className="avatar-share-tail" aria-hidden="true" />
              {greeting}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="avatar-share-dots" aria-hidden="true">
        {cards.map((card, index) => (
          <i key={card.tone} className={index === page ? "on" : undefined} />
        ))}
      </div>
      <nav className="avatar-share-actions">
        <button type="button" onClick={() => void shareText(greeting)}>
          <span>
            <Share size={23} strokeWidth={1.8} />
          </span>
          {t("Share")}
        </button>
        <a href={`sms:&body=${encodeURIComponent(greeting)}`}>
          <span>
            <MessageCircle size={23} strokeWidth={1.8} />
          </span>
          {t("Messages")}
        </a>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(greeting).then(() => {
              setCopied(true);
            })
          }
        >
          <span>
            <Copy size={22} strokeWidth={1.8} />
          </span>
          {copied ? t("Copied") : t("Copy")}
        </button>
      </nav>
    </dialog>
  );
}
