import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  X,
} from "lucide-react";
import { t } from "../shared/i18n";
import {
  activitySteps,
  clockTime,
  plainText,
  type ActivityTurn,
} from "../shared/activity";
import { eventText } from "../shared/types";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./activity-detail.css";

// One request in detail, over the activity list: how it ended, what it was
// and when, the answer, and every step it took, each opening to what went in
// and came back.
export function ActivityDetail({
  turn,
  title,
  running,
  onClose,
}: {
  turn: ActivityTurn;
  title: string;
  running: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const [open, setOpen] = useState<string>();
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
  const steps = activitySteps(turn, running);
  const answer = [...turn.events]
    .reverse()
    .find((event) => event.type === "agent.message");
  const state = turn.error ? "failed" : running ? "running" : "done";
  // The answer past its first line, which the summary line already shows.
  const rest = answer
    ? plainText(
        eventText(answer)
          .split("\n")
          .filter((line) => line.trim() && !line.trim().startsWith("|"))
          .slice(1)
          .join("\n"),
      )
    : "";
  return (
    <dialog
      ref={dialog}
      className="activity-detail"
      tabIndex={-1}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <ContinuousSurface />
      <div className="activity-detail-content">
        <header className="activity-detail-head" {...drag}>
          <span className={`activity-detail-state ${state}`}>
            {state === "failed"
              ? t("Failed")
              : state === "running"
                ? t("In progress")
                : t("Done")}
          </span>
          <button
            type="button"
            className="activity-detail-close"
            aria-label={t("Close")}
            onClick={dismiss}
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </header>
        <h2 className="activity-detail-title">{title}</h2>
        {turn.reply && <p className="activity-detail-line">{turn.reply}</p>}
        <time dateTime={turn.at}>{clockTime(turn.at)}</time>
        {(turn.error || rest) && (
          <div className="activity-detail-answer">
            <p>{turn.error ?? rest}</p>
          </div>
        )}
        {steps.length > 0 && (
          <>
            <h3 className="activity-detail-group">MAIN</h3>
            <ol className="activity-steps">
              {steps.map((step) => (
                <li key={step.id} className={step.state}>
                  <button
                    type="button"
                    aria-expanded={open === step.id}
                    onClick={() =>
                      setOpen(open === step.id ? undefined : step.id)
                    }
                  >
                    <span className="activity-step-icon" aria-hidden="true">
                      {step.state === "failed" ? (
                        <CircleAlert size={18} />
                      ) : step.state === "running" ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <CircleCheck size={18} />
                      )}
                    </span>
                    <span className="activity-step-text">
                      <strong>
                        {t(step.label)}
                        {step.target && `：${step.target}`}
                      </strong>
                      {step.note && <small>{step.note}</small>}
                    </span>
                    <ChevronRight
                      size={16}
                      className="activity-step-chevron"
                      aria-hidden="true"
                    />
                  </button>
                  {open === step.id && (
                    <div className="activity-step-io">
                      <pre>{step.input}</pre>
                      {step.result && <pre>{step.result}</pre>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </dialog>
  );
}
