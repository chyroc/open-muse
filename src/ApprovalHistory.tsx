import { useEffect, useRef, useState } from "react";
import { Globe2, HeartPulse, Monitor, Wrench, X } from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import { approvalHistory, type ApprovalRecord } from "../shared/approvals";
import type { AgentEvent } from "../shared/types";
import { dateLabel } from "./components";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./activity-detail.css";

const icons = { web: Globe2, health: HeartPulse, mac: Monitor, tool: Wrench };

// "9 hours ago", in the selected language.
export function timeAgo(at: string, now = Date.now()) {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const format = new Intl.RelativeTimeFormat(formatLocale(), {
    numeric: "auto",
  });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  return format.format(0, "second");
}

const title = (record: ApprovalRecord) =>
  t(record.title, { tool: record.tool });
const outcome = (record: ApprovalRecord) =>
  record.result === "allow" ? t("Allowed") : t("Denied");

// The requests the person has answered in this conversation, each opening to
// what exactly was asked.
export function ApprovalHistory({ events }: { events: readonly AgentEvent[] }) {
  const records = approvalHistory(events);
  const [open, setOpen] = useState<ApprovalRecord>();
  if (!records.length) return null;
  return (
    <section className="approval-history">
      <h3>{t("Review history")}</h3>
      <ul>
        {records.map((record) => {
          const Icon = icons[record.kind];
          return (
            <li key={record.id}>
              <button type="button" onClick={() => setOpen(record)}>
                <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  <strong>{title(record)}</strong>
                  {record.detail && <span>{record.detail}</span>}
                  <small>
                    {outcome(record)}
                    {record.at && ` · ${timeAgo(record.at)}`}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <ApprovalDetail record={open} onClose={() => setOpen(undefined)} />
      )}
    </section>
  );
}

function ApprovalDetail({
  record,
  onClose,
}: {
  record: ApprovalRecord;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
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
      className="activity-detail approval-detail"
      tabIndex={-1}
      aria-label={title(record)}
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
          <span className={`approval-outcome ${record.result}`}>
            {outcome(record)}
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
        <h2 className="activity-detail-title">{title(record)}</h2>
        {record.detail && (
          <p className="activity-detail-line">{record.detail}</p>
        )}
        {record.at && <time dateTime={record.at}>{dateLabel(record.at)}</time>}
        <h3 className="approval-detail-label">{t("Details")}</h3>
        <pre className="approval-detail-input">{record.input}</pre>
      </div>
    </dialog>
  );
}
