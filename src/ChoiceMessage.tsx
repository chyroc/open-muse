import { Check } from "lucide-react";
import { parseChoiceMessage, type ChoiceReply } from "../shared/chat-choices";
import { Markdown } from "./components";
import "./choices.css";

export function ChoiceMessage({
  text,
  reply,
  active,
  busy,
  streaming,
  onChoose,
}: {
  text: string;
  reply?: ChoiceReply;
  active: boolean;
  busy: boolean;
  streaming: boolean;
  onChoose: (id: string) => void;
}) {
  const message = parseChoiceMessage(text);
  const answered = reply && reply.state !== "rejected";
  const disabled = busy || streaming || !active || Boolean(answered);
  return (
    <>
      {message.text && <Markdown text={message.text} />}
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
                  aria-label={`Choose ${option.label}`}
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
              Selection awaiting confirmation. Refresh history to check; it will
              not be sent again.
            </small>
          )}
          {reply?.state === "rejected" && (
            <small role="status">
              Your selection was not accepted. You can choose again.
            </small>
          )}
        </section>
      )}
      {(message.invalid || (message.pending && !streaming)) && (
        <p className="choice-unavailable">
          This question could not be displayed. You can reply in the message
          field.
        </p>
      )}
      {message.pending && streaming && (
        <span className="choice-unavailable" role="status">
          Preparing a question…
        </span>
      )}
    </>
  );
}
