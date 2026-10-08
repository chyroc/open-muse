import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, LoaderCircle, X } from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import { onAndroid } from "./platform";
import {
  describeSchedule,
  nextOccurrence,
  type UpcomingDelivery,
  type UpcomingItem,
} from "../shared/upcoming";
import type { Client } from "./api";
import { clockTime } from "../shared/activity";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./upcoming.css";
import {
  announceReminders,
  reminderNotificationsSupported,
} from "./reminderNotifications";

type Snapshot = { items: UpcomingItem[]; revision: string };

// Reminders and recurring tasks saved in personal memory, soonest first.
// Groups follow how often an item repeats, most frequent first.
const repetitions = ["daily", "weekly", "monthly", "yearly", "once"] as const;
const repetitionLabels = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
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
  const [open, setOpen] = useState<string>();
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
    if (!snapshot || busy) return false;
    if (
      action === "delete" &&
      !window.confirm(t("Delete “{title}”?", { title: item.title }))
    )
      return false;
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
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
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
  const opened = items.find(({ item }) => item.id === open);
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
                    <button type="button" onClick={() => setOpen(item.id)}>
                      <ScheduleTile />
                      <div>
                        <strong>{item.title}</strong>
                        <span>{describeSchedule(item, locale)}</span>
                        <small>
                          {item.status === "paused"
                            ? t("Paused")
                            : next
                              ? clockTime(new Date(next).toISOString())
                              : t("No upcoming time")}
                        </small>
                      </div>
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
      {opened && (
        <UpcomingDetail
          item={opened.item}
          next={opened.next}
          busy={busy === opened.item.id}
          onChange={(action) =>
            void change(opened.item, action).then((done) => {
              if (done && action === "delete") setOpen(undefined);
            })
          }
          onClose={() => setOpen(undefined)}
        />
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
            ? onAndroid()
              ? t(
                  "This phone also shows a notification when an item falls due, if you allow notifications.",
                )
              : t(
                  "This iPhone also shows a notification when an item falls due, if you allow notifications.",
                )
            : t("This device does not show notifications for reminders.")}
        </p>
      )}
    </section>
  );
}

// A calendar page with a clock on its corner.
function ScheduleTile() {
  return (
    <svg
      className="schedule-tile"
      width="44"
      height="44"
      viewBox="0 0 44 44"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="34" height="31" rx="7" fill="#fff" />
      <path d="M3 12a7 7 0 0 1 7-7h20a7 7 0 0 1 7 7z" fill="#ececee" />
      <rect
        x="3.25"
        y="5.25"
        width="33.5"
        height="30.5"
        rx="6.75"
        fill="none"
        stroke="#dcdce0"
        strokeWidth=".5"
      />
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3, 4].map((column) => (
          <circle
            key={`${row}-${column}`}
            cx={10 + column * 5}
            cy={17 + row * 5}
            r="1.1"
            fill="#9a9aa0"
          />
        )),
      )}
      <circle cx="33" cy="31" r="8.5" fill="#e8b02c" />
      <path
        d="M33 26.5V31h-3.5"
        fill="none"
        stroke="#3a2a00"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// One reminder in detail: how it repeats, when it next runs, and controls to
// pause or delete it.
function UpcomingDetail({
  item,
  next,
  busy,
  onChange,
  onClose,
}: {
  item: UpcomingItem;
  next?: number;
  busy: boolean;
  onChange: (action: "pause" | "resume" | "delete") => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const locale = formatLocale();
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
  const paused = item.status === "paused";
  return (
    <dialog
      ref={dialog}
      className="activity-detail upcoming-detail"
      tabIndex={-1}
      aria-label={item.title}
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
          <span className="upcoming-state">
            {paused ? t("Paused") : t("Scheduled task")}
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
        <h2 className="activity-detail-title">{item.title}</h2>
        <p className="upcoming-detail-schedule">
          {describeSchedule(item, locale)}
        </p>
        <ul className="upcoming-detail-runs">
          <li>
            <span>
              <strong>
                {next
                  ? new Date(next).toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                      weekday: "short",
                    })
                  : t("No upcoming time")}
              </strong>
              {next && (
                <small>
                  {new Date(next).toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </span>
            <em>{paused ? t("Paused") : t("Set time")}</em>
          </li>
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange(paused ? "resume" : "pause")}
            >
              {paused ? t("Resume") : t("Pause")}
              {busy && <LoaderCircle size={18} className="spin" />}
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="upcoming-detail-delete"
          disabled={busy}
          onClick={() => onChange("delete")}
        >
          {t("Delete")}
        </button>
      </div>
    </dialog>
  );
}
