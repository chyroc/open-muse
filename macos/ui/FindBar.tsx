import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { t } from "../../shared/i18n";
import { eventText, type AgentEvent } from "../../shared/types";
import type { MessagePart } from "./ChoiceContent";

export const partKey = ({ event, part }: MessagePart) => `${event.id}:${part}`;

// The bubbles in this conversation whose text contains the query.
export function findMatches(
  parts: MessagePart[],
  query: string,
  names: (event: AgentEvent) => string[] = () => [],
) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return parts
    .filter(({ event }) =>
      [eventText(event), ...names(event)].some((text) =>
        text.toLocaleLowerCase().includes(term),
      ),
    )
    .map(partKey);
}

export function FindBar({
  query,
  onQuery,
  count,
  position,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  count: number;
  position: number;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <div className="find-bar" role="search">
      <Search size={15} />
      <input
        ref={field}
        value={query}
        placeholder={t("Find in this chat")}
        aria-label={t("Find in this chat")}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            onStep(-1);
          }
        }}
      />
      <span className="find-count" role="status">
        {query.trim()
          ? count
            ? t("{position} of {count}", { position: position + 1, count })
            : t("No matches")
          : ""}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={t("Previous match")}
        disabled={!count}
        onClick={() => onStep(-1)}
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t("Next match")}
        disabled={!count}
        onClick={() => onStep(1)}
      >
        <ChevronDown size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t("Close find")}
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
