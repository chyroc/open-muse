import { useState } from "react";
import { formatLocale, t } from "../shared/i18n";
import {
  activityDay,
  activityTurns,
  clockTime,
  type ActivityTurn,
} from "../shared/activity";
import type { AgentEvent } from "../shared/types";
import { ActivityDetail } from "./ActivityDetail";

function dayLabel(at: string) {
  const day = activityDay(at);
  if (day === "today") return t("Today");
  if (day === "yesterday") return t("Yesterday");
  const date = new Date(at);
  return day === "week"
    ? date.toLocaleDateString(formatLocale(), { weekday: "long" })
    : date.toLocaleDateString(formatLocale(), {
        month: "long",
        day: "numeric",
      });
}

const initiationLabels = {
  welcome: "Welcome",
  checkin: "Check-in",
  reminder: "Reminder",
} as const;

function TaskGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="7.5" cy="7.5" r="3.3" />
        <circle cx="16.5" cy="7.5" r="3.3" />
        <circle cx="7.5" cy="16.5" r="3.3" />
        <circle cx="16.5" cy="16.5" r="3.3" />
      </g>
    </svg>
  );
}

// Requests the companion acted on, newest first and grouped by day. Each row
// opens that request's detail over the list.
export function ActivityList({
  events,
  running,
}: {
  events: AgentEvent[];
  running: boolean;
}) {
  const turns = activityTurns(events);
  const [open, setOpen] = useState<string>();
  const groups: { label: string; turns: ActivityTurn[] }[] = [];
  for (const turn of turns) {
    const label = dayLabel(turn.at);
    if (groups.at(-1)?.label === label) groups.at(-1)!.turns.push(turn);
    else groups.push({ label, turns: [turn] });
  }
  return (
    <div className="activity-list">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3>{group.label}</h3>
          {group.turns.map((turn, index) => {
            const latest = turn === turns[0];
            const summary =
              turn.error ??
              (turn.reply ||
                (latest && running ? t("In progress") : t("No reply yet")));
            const title = turn.initiation
              ? t(initiationLabels[turn.initiation])
              : turn.request || t("Request {n}", { n: index + 1 });
            return (
              <div key={turn.id} className="activity-turn">
                <button aria-haspopup="dialog" onClick={() => setOpen(turn.id)}>
                  <span className="activity-turn-icon">
                    <TaskGlyph />
                  </span>
                  <span className="activity-turn-text">
                    <strong>{title}</strong>
                    <span className={turn.error ? "error-text" : undefined}>
                      {summary}
                    </span>
                    <time dateTime={turn.at}>{clockTime(turn.at)}</time>
                  </span>
                </button>
                {open === turn.id && (
                  <ActivityDetail
                    turn={turn}
                    title={title}
                    running={latest && running}
                    onClose={() => setOpen(undefined)}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
