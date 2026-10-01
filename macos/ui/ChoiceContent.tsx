import { Check } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  parseChoiceMessage,
  type ChoiceReply,
} from "../../shared/chat-choices";
import { isWelcomeReply } from "../../shared/welcome";
import { eventText, type AgentEvent } from "../../shared/types";
import { Markdown } from "../../src/components";

// One rendered bubble. The welcome greeting and its naming question are two
// bubbles cut from the same MA event, so actions keep that event's provenance.
export type MessagePart = {
  event: AgentEvent;
  part: "all" | "intro" | "choice";
};

export function messageParts(
  messages: AgentEvent[],
  history: AgentEvent[],
): MessagePart[] {
  return messages.flatMap((event): MessagePart[] => {
    if (event.type !== "agent.message") return [{ event, part: "all" }];
    const welcome = event.welcome_reply || isWelcomeReply(history, event.id);
    const parsed = parseChoiceMessage(eventText(event));
    return welcome && parsed.choice && parsed.before
      ? [
          { event, part: "intro" },
          { event, part: "choice" },
        ]
      : [{ event, part: "all" }];
  });
}

// The assistant's text, with any muse-choice block as option buttons. Only the
// latest unanswered question in the open conversation is active.
export function AssistantContent({
  text,
  part,
  reply,
  active,
  busy,
  streaming,
  onChoose,
}: {
  text: string;
  part: MessagePart["part"];
  reply?: ChoiceReply;
  active: boolean;
  busy: boolean;
  streaming: boolean;
  onChoose: (option: string) => void;
}) {
  const message = parseChoiceMessage(text);
  if (part === "intro") return <Markdown text={message.before ?? ""} />;
  const answered = reply && reply.state !== "rejected";
  const disabled = busy || streaming || !active || Boolean(answered);
  const intro = part === "all" ? (message.before ?? message.text) : undefined;
  return (
    <>
      {intro && <Markdown text={intro} />}
      {message.choice && (
        <section className="mac-choice" aria-label={message.choice.question}>
          <p>{message.choice.question}</p>
          <div className="mac-choice-options">
            {message.choice.options.map((option) => {
              const selected =
                reply?.optionId === option.id && reply.state === "confirmed";
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={t("Choose {label}", { label: option.label })}
                  aria-pressed={selected}
                  className={
                    selected
                      ? "selected"
                      : answered || !active
                        ? "inactive"
                        : ""
                  }
                  disabled={disabled}
                  onClick={() => onChoose(option.id)}
                >
                  <span>{option.label}</span>
                  {selected && <Check size={15} strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
          {reply && ["sending", "unconfirmed"].includes(reply.state) && (
            <small role="status">
              {t(
                "Selection awaiting confirmation. Refresh history to check; it will not be sent again.",
              )}
            </small>
          )}
          {reply?.state === "rejected" && (
            <small role="status">
              {t("Your selection was not accepted. You can choose again.")}
            </small>
          )}
        </section>
      )}
      {message.after && <Markdown text={message.after} />}
      {(message.invalid || (message.pending && !streaming)) && (
        <p className="mac-choice-note">
          {t(
            "This question could not be displayed. You can reply in the message field.",
          )}
        </p>
      )}
      {message.pending && streaming && (
        <span className="mac-choice-note" role="status">
          {t("Preparing a question…")}
        </span>
      )}
    </>
  );
}
