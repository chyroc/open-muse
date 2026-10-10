import { t } from "../shared/i18n";
import type { MessageCard } from "../shared/message-card";
import "./message-cards.css";

// The post or idea a message was about, as a card under the person's words;
// it opens the page it came from.
export function MessageCards({
  cards,
  onOpen,
}: {
  cards: MessageCard[];
  onOpen: (page: "feed" | "ideas") => void;
}) {
  if (!cards.length) return null;
  return (
    <div className="message-cards">
      {cards.map((card, index) => {
        const page =
          card.kind === "feed" || card.kind === "ideas" ? card.kind : undefined;
        const label =
          page === "feed" ? t("Feed") : page === "ideas" ? t("Ideas") : "";
        const content = (
          <>
            {label && <span className="message-card-kind">{label}</span>}
            {card.title && <strong>{card.title}</strong>}
            {card.body && (
              <span className="message-card-body">{card.body}</span>
            )}
          </>
        );
        return page ? (
          <button
            type="button"
            key={index}
            className="message-card"
            aria-label={t("Open {title}", { title: card.title ?? label })}
            onClick={() => onOpen(page)}
          >
            {content}
          </button>
        ) : (
          <div key={index} className="message-card">
            {content}
          </div>
        );
      })}
    </div>
  );
}
