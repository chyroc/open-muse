import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import {
  describeSchedule,
  nextOccurrence,
  type UpcomingItem,
} from "../shared/upcoming";
import type { Client } from "./api";
import "./upcoming.css";

type Snapshot = { items: UpcomingItem[]; revision: string };

// Reminders and recurring tasks saved in personal memory, soonest first.
export function UpcomingPanel({
  client,
  name,
}: {
  client: Client;
  name: string;
}) {
  const signedIn = client.signedIn();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const load = useCallback(() => {
    setError("");
    return client
      .upcoming()
      .then(setSnapshot)
      .catch((reason: Error) => setError(reason.message));
  }, [client]);
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);
  async function change(
    item: UpcomingItem,
    action: "pause" | "resume" | "delete",
  ) {
    if (!snapshot || busy) return;
    if (
      action === "delete" &&
      !window.confirm(t("Delete “{title}”?", { title: item.title }))
    )
      return;
    setBusy(item.id);
    setError("");
    try {
      setSnapshot(
        await client.changeUpcoming(item.id, action, snapshot.revision),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  }
  const now = Date.now();
  const locale = formatLocale();
  const items = [...(snapshot?.items ?? [])]
    .filter((item) => item.status !== "done")
    .map((item) => ({ item, next: nextOccurrence(item, now) }))
    .sort(
      (a, b) =>
        (a.item.status === "paused" ? 1 : 0) -
          (b.item.status === "paused" ? 1 : 0) ||
        (a.next ?? Infinity) - (b.next ?? Infinity),
    );
  return (
    <section className="companion-upcoming">
      <div className="upcoming-heading">
        <h2>{t("Upcoming")}</h2>
        {signedIn && (
          <button
            className="icon-button"
            aria-label={t("Refresh upcoming items")}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!signedIn ? (
        <div className="companion-empty">
          <CalendarClock size={30} />
          <h3>{t("Nothing upcoming")}</h3>
          <p>{t("Connect to MA to keep reminders and recurring tasks.")}</p>
        </div>
      ) : !snapshot && !error ? (
        <div className="companion-empty" role="status">
          <LoaderCircle size={26} className="spin" />
        </div>
      ) : items.length ? (
        <ul className="upcoming-list">
          {items.map(({ item, next }) => (
            <li
              key={item.id}
              className={item.status === "paused" ? "paused" : undefined}
            >
              <CalendarClock size={21} />
              <div>
                <strong>{item.title}</strong>
                <span>{describeSchedule(item, locale)}</span>
                <small>
                  {item.status === "paused"
                    ? t("Paused")
                    : next
                      ? t("Next: {date}", {
                          date: new Date(next).toLocaleString(locale, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }),
                        })
                      : t("No upcoming time")}
                </small>
              </div>
              <button
                className="icon-button"
                disabled={Boolean(busy)}
                aria-label={t(
                  item.status === "paused" ? "Resume {title}" : "Pause {title}",
                  { title: item.title },
                )}
                onClick={() =>
                  void change(
                    item,
                    item.status === "paused" ? "resume" : "pause",
                  )
                }
              >
                {busy === item.id ? (
                  <LoaderCircle size={18} className="spin" />
                ) : item.status === "paused" ? (
                  <Play size={18} />
                ) : (
                  <Pause size={18} />
                )}
              </button>
              <button
                className="icon-button"
                disabled={Boolean(busy)}
                aria-label={t("Delete {title}", { title: item.title })}
                onClick={() => void change(item, "delete")}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        snapshot && (
          <div className="companion-empty">
            <CalendarClock size={30} />
            <h3>{t("Nothing upcoming")}</h3>
            <p>
              {t(
                "Ask {name} in chat, for example “Every Monday at 9am, remind me to submit my timesheet.”",
                { name },
              )}
            </p>
          </div>
        )
      )}
      {signedIn && (
        <p className="upcoming-note">
          {t(
            "Reminders arrive in the main chat when Open Muse is open at or after their time. There are no push notifications yet.",
          )}
        </p>
      )}
    </section>
  );
}
