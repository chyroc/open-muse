import { Lightbulb, Newspaper } from "lucide-react";
import { t } from "../../shared/i18n";
import type { MessageCard } from "../../shared/message-card";
import { focusPath } from "./focusItem";

// The post or idea a message was about, as a card under the person's words.
// It opens the post in the feed, or the idea, where it came from.
export function MessageCards({
  cards,
  onOpen,
}: {
  cards: MessageCard[];
  // Without it, as in Quick chat, the cards only show what was quoted.
  onOpen?: (path: string) => void;
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
            <span className="message-card-kind">
              {page === "ideas" ? (
                <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Newspaper size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              {label}
            </span>
            {card.title && <strong>{card.title}</strong>}
            {card.body && (
              <span className="message-card-body">{card.body}</span>
            )}
          </>
        );
        return page && onOpen ? (
          <button
            type="button"
            key={index}
            className="message-card"
            aria-label={t("Open {title}", { title: card.title ?? label })}
            onClick={() => onOpen(focusPath(page, card))}
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
