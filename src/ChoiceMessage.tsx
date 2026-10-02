import { t } from "../shared/i18n";
import { Check } from "lucide-react";
import { parseChoiceMessage, type ChoiceReply } from "../shared/chat-choices";
import { Markdown } from "./components";
import "./choices.css";
import { MessageBubble } from "./ChatUI";

export function ChoiceMessage({
  text,
  reply,
  active,
  busy,
  streaming,
  onChoose,
  omitIntroduction = false,
}: {
  text: string;
  reply?: ChoiceReply;
  active: boolean;
  busy: boolean;
  streaming: boolean;
  onChoose: (id: string) => void;
  omitIntroduction?: boolean;
}) {
  const message = parseChoiceMessage(text);
  const answered = reply && reply.state !== "rejected";
  const disabled = busy || streaming || !active || Boolean(answered);
  return (
    <>
      {!omitIntroduction && (message.before ?? message.text) && (
        <Markdown text={message.before ?? message.text} />
      )}
      {message.choice && (
        <section className="chat-choice" aria-label={message.choice.question}>
          <p>{message.choice.question}</p>
          <div className="chat-choice-options">
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
                  {selected && (
                    <span className="choice-check">
                      <Check size={17} strokeWidth={3} />
                    </span>
                  )}
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
        <p className="choice-unavailable">
          {t(
            "This question could not be displayed. You can reply in the message field.",
          )}
        </p>
      )}
      {message.pending && streaming && (
        <span className="choice-unavailable" role="status">
          {t("Preparing a question…")}
        </span>
      )}
    </>
  );
}

// Keep the greeting and naming question in separate bubbles. Both are real
// text from the same MA event; actions retain that event's source provenance.
export function AssistantMessage({
  welcome,
  label,
  onOptions,
  ...props
}: Parameters<typeof ChoiceMessage>[0] & {
  welcome?: boolean;
  label: string;
  onOptions: (bubble?: HTMLElement) => void;
}) {
  const message = parseChoiceMessage(props.text);
  const split = welcome && message.choice && Boolean(message.before);
  return (
    <>
      {split && (
        <MessageBubble label={label} onOptions={onOptions}>
          <Markdown text={message.before!} />
        </MessageBubble>
      )}
      <MessageBubble label={label} onOptions={onOptions}>
        <ChoiceMessage {...props} omitIntroduction={Boolean(split)} />
      </MessageBubble>
    </>
  );
}
