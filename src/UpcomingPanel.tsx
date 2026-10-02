import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  LoaderCircle,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import {
  describeSchedule,
  nextOccurrence,
  type UpcomingDelivery,
  type UpcomingItem,
} from "../shared/upcoming";
import type { Client } from "./api";
import "./upcoming.css";
import {
  announceReminders,
  reminderNotificationsSupported,
} from "./reminderNotifications";

type Snapshot = { items: UpcomingItem[]; revision: string };

// Reminders and recurring tasks saved in personal memory, soonest first.
// Groups follow how often an item repeats, most frequent first.
const repetitions = ["daily", "weekly", "monthly", "once"] as const;
const repetitionLabels = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  once: "One time",
} as const;

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
  const supported = client.upcomingDeliverySupported();
  const [delivery, setDelivery] = useState<UpcomingDelivery>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
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
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void client
      .upcomingDelivery()
      .then((value) => {
        if (active) setDelivery(value);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [client, supported]);
  async function toggleDelivery(enabled: boolean) {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    setError("");
    try {
      setDelivery(await client.setUpcomingDelivery(enabled));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setDeliveryBusy(false);
    }
  }
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
      const next = await client.changeUpcoming(
        item.id,
        action,
        snapshot.revision,
      );
      setSnapshot(next);
      // Paused and deleted items stop being announced at once.
      announceReminders(next.items);
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
        repetitions
          .map((kind) => ({
            kind,
            entries: items.filter(({ item }) => item.schedule.kind === kind),
          }))
          .filter((group) => group.entries.length)
          .map((group) => (
            <section key={group.kind} className="upcoming-group">
              <h3>{t(repetitionLabels[group.kind])}</h3>
              <ul className="upcoming-list">
                {group.entries.map(({ item, next }) => (
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
                        item.status === "paused"
                          ? "Resume {title}"
                          : "Pause {title}",
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
            </section>
          ))
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
      {supported && (
        <label className="background-toggle upcoming-delivery">
          <input
            type="checkbox"
            checked={delivery?.enabled ?? false}
            disabled={!delivery || deliveryBusy}
            onChange={(event) => void toggleDelivery(event.target.checked)}
          />
          {t("Deliver even when Open Muse is closed")}
        </label>
      )}
      {signedIn && (
        <p className="upcoming-note">
          {delivery?.enabled
            ? delivery.state === "session_unavailable"
              ? t(
                  "The Open Muse service can no longer reach your main chat. Open the main chat to register it again.",
                )
              : t(
                  "The Open Muse service sends due reminders to your main chat even when the app is closed, and your agent handles them with its tools. Steps that need approval wait for you.",
                )
            : supported
              ? t(
                  "Reminders arrive in the main chat when Open Muse is open at or after their time. Turn on delivery while closed to let the Open Muse service use your saved Ark key to run them while you are away; each one is a real Ark request and may be billed.",
                )
              : t(
                  "Reminders arrive in the main chat when Open Muse is open at or after their time.",
                )}{" "}
          {reminderNotificationsSupported()
            ? t(
                "This iPhone also shows a notification when an item falls due, if you allow notifications.",
              )
            : t("This device does not show notifications for reminders.")}
        </p>
      )}
    </section>
  );
}
