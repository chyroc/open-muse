import { useEffect, useRef, useState } from "react";
import { formatLocale, systemLanguage, t } from "../shared/i18n";
import {
  activityDay,
  activitySteps,
  activityTurns,
  clockTime,
  type ActivityTurn,
} from "../shared/activity";
import {
  summaryRetryAfter,
  type ActivitySummary,
  type SummaryRecord,
} from "../shared/activity-summary";
import type { Client } from "./api";
import type { AgentEvent } from "../shared/types";
import { ActivityDetail } from "./ActivityDetail";
import "./activity-list.css";

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
  browser: "Cloud browser",
  webhook: "Webhook",
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

// Labels for finished requests: those kept on this device, then the newest
// unlabeled ones, written one at a time while the list is open.
function useSummaries(
  client: Client | undefined,
  turns: ActivityTurn[],
  running: boolean,
) {
  const [summaries, setSummaries] = useState<Record<string, SummaryRecord>>();
  const tried = useRef(new Set<string>());
  const language = systemLanguage();
  const signedIn = Boolean(client?.signedIn());
  useEffect(() => {
    if (!client || !signedIn) return;
    let active = true;
    void client
      .activitySummaries()
      .then((value) => {
        if (active) setSummaries(value);
      })
      .catch(() => {
        if (active) setSummaries({});
      });
    return () => {
      active = false;
    };
  }, [client, signedIn]);
  const due = (record: SummaryRecord | undefined) =>
    !record ||
    ("failed" in record
      ? Date.now() - record.failed > summaryRetryAfter
      : record.language !== language);
  // The newest ten finished requests still without labels.
  const pending = summaries
    ? turns
        .filter(
          (turn, index) =>
            !(index === 0 && running) &&
            due(summaries[turn.id]) &&
            !tried.current.has(turn.id),
        )
        .slice(0, 10)
    : [];
  const queue = useRef(pending);
  queue.current = pending;
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // One request at a time, taking the next unlabeled request after each.
  useEffect(() => {
    if (!client || working.current || !pending.length) return;
    working.current = true;
    void (async () => {
      try {
        for (;;) {
          const turn = queue.current.find(
            (item) => !tried.current.has(item.id),
          );
          if (!turn || !mounted.current) return;
          tried.current.add(turn.id);
          const summary = await client.summarizeActivity(
            turn,
            activitySteps(turn, false),
            language,
          );
          if (mounted.current)
            setSummaries((current) => ({
              ...current,
              [turn.id]: summary ?? { failed: Date.now() },
            }));
        }
      } catch {
        // Labels are optional; the request's own words remain.
      } finally {
        working.current = false;
      }
    })();
  });
  return (id: string): ActivitySummary | undefined => {
    const record = summaries?.[id];
    return record && !("failed" in record) && record.language === language
      ? record
      : undefined;
  };
}

// Requests the companion acted on, newest first and grouped by day. Each row
// opens that request's detail over the list.
export function ActivityList({
  events,
  running,
  client,
}: {
  events: AgentEvent[];
  running: boolean;
  client?: Client;
}) {
  const turns = activityTurns(events);
  const summaryOf = useSummaries(client, turns, running);
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
            const labels = summaryOf(turn.id);
            const summary =
              turn.error ??
              (labels?.summary ||
                turn.reply ||
                (latest && running ? t("In progress") : t("No reply yet")));
            const title = turn.initiation
              ? t(initiationLabels[turn.initiation])
              : labels?.title ||
                turn.request ||
                t("Request {n}", { n: index + 1 });
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
                    summary={labels}
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
