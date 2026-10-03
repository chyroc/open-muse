import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
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
import { Markdown } from "./components";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./activity-detail.css";

// One request in detail, over the activity list: how it ended, what it was
// and when, the answer, and every step it took, each opening to what went in
// and came back on a page of its own.
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
  // The step shown on its own page, and whether that page is leaving.
  const [open, setOpen] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [opened, setOpened] = useState(false);
  // Like a system sheet, scrolling the half-height sheet raises it to full.
  const [expanded, setExpanded] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
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
  const step = steps.find((item) => item.id === open);
  // A step page starts at its top; the list comes back where it was left.
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = step ? 0 : scroll.current;
  }, [step]);
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
      className={`activity-detail${expanded ? " expanded" : ""}`}
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
      <div
        className="activity-detail-content"
        ref={content}
        onScroll={(event) => {
          if (!expanded && event.currentTarget.scrollTop > 0) setExpanded(true);
        }}
      >
        {step ? (
          <section
            key={step.id}
            className={`activity-step-page${leaving ? " leaving" : ""}`}
            onAnimationEnd={(event) => {
              if (leaving && event.target === event.currentTarget) {
                setLeaving(false);
                setOpen(undefined);
              }
            }}
          >
            <header className="activity-detail-head" {...drag}>
              <button
                type="button"
                className="activity-detail-close"
                aria-label={t("Back")}
                onClick={() => setLeaving(true)}
              >
                <ArrowLeft size={20} strokeWidth={2.2} />
              </button>
            </header>
            <h2 className="activity-step-title">
              {t(step.label)}
              {step.target && `：${step.target}`}
            </h2>
            {step.note && (
              <div className="activity-step-note">
                <Markdown text={step.note} />
              </div>
            )}
            {step.result ? (
              <div className="activity-step-result">
                <Markdown text={step.result} />
              </div>
            ) : (
              <pre className="activity-step-input">{step.input}</pre>
            )}
          </section>
        ) : (
          <div
            className={opened ? "activity-detail-main returning" : undefined}
          >
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
                  {steps.map((item) => (
                    <li key={item.id} className={item.state}>
                      <button
                        type="button"
                        onClick={() => {
                          scroll.current = content.current?.scrollTop ?? 0;
                          setOpened(true);
                          setOpen(item.id);
                        }}
                      >
                        <span className="activity-step-icon" aria-hidden="true">
                          {item.state === "failed" ? (
                            <CircleAlert size={20} />
                          ) : item.state === "running" ? (
                            <LoaderCircle size={20} className="spin" />
                          ) : (
                            <CircleCheck size={20} />
                          )}
                        </span>
                        <span className="activity-step-text">
                          <strong>
                            {t(item.label)}
                            {item.target && `：${item.target}`}
                          </strong>
                          {item.note && <small>{item.note}</small>}
                        </span>
                        <ChevronRight
                          size={16}
                          className="activity-step-chevron"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
