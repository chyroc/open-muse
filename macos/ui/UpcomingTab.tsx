import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { formatLocale, t } from "../../shared/i18n";
import {
  describeSchedule,
  nextOccurrence,
  type UpcomingDelivery,
  type UpcomingItem,
} from "../../shared/upcoming";
import type { Client } from "../../src/api";
import { Empty, Modal } from "./Chrome";
import { Switch } from "./SettingsSwitch";

type Snapshot = { items: UpcomingItem[]; revision: string };
type Action = "pause" | "resume" | "delete";

export const upcomingChanged = "muse-upcoming-changed";

// Soonest first; paused items follow, finished one-off items are not listed.
export function upcomingRows(items: UpcomingItem[], now: number) {
  return items
    .filter((item) => item.status !== "done")
    .map((item) => ({ item, next: nextOccurrence(item, now) }))
    .sort(
      (a, b) =>
        (a.next ?? Number.MAX_SAFE_INTEGER) -
          (b.next ?? Number.MAX_SAFE_INTEGER) ||
        a.item.title.localeCompare(b.item.title),
    );
}

export function editDraft(item: UpcomingItem) {
  return `${t("Change the scheduled task “{title}”:", { title: item.title })} `;
}

function when(at: number | undefined) {
  if (at === undefined) return t("Paused");
  return new Date(at).toLocaleString(formatLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Reminders and recurring tasks saved in personal memory. Editing drafts a
// chat message for the person to send; pausing, resuming and removing rewrite
// UPCOMING.md with a revision check, so a concurrent change is never lost.
export function UpcomingTab({
  client,
  connected,
  onEdit,
}: {
  client: Client;
  connected: boolean;
  onEdit: (text: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<UpcomingItem>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState<{
    item: UpcomingItem;
    x: number;
    y: number;
  }>();
  const alive = useRef(true);
  // Account builds can let the service deliver while the app is closed.
  const supported = connected && client.upcomingDeliverySupported();
  const [delivery, setDelivery] = useState<UpcomingDelivery>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void client
      .upcomingDelivery()
      .then((value) => active && setDelivery(value))
      .catch((failure: Error) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [client, supported]);
  async function toggleDelivery(enabled: boolean) {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    setError("");
    try {
      const value = await client.setUpcomingDelivery(enabled);
      if (alive.current) setDelivery(value);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setDeliveryBusy(false);
    }
  }
  const load = useCallback(() => {
    if (!connected) return;
    void client
      .upcoming()
      .then((value) => {
        if (!alive.current) return;
        setSnapshot(value);
        setError("");
      })
      .catch((failure: Error) => alive.current && setError(failure.message));
  }, [client, connected]);
  useEffect(() => {
    alive.current = true;
    load();
    window.addEventListener("focus", load);
    window.addEventListener(upcomingChanged, load);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", load);
      window.removeEventListener(upcomingChanged, load);
    };
  }, [load]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  async function change(item: UpcomingItem, action: Action) {
    if (!snapshot || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await client.changeUpcoming(
        item.id,
        action,
        snapshot.revision,
      );
      if (!alive.current) return;
      setSnapshot(next);
      setOpen((current) =>
        current && action !== "delete"
          ? next.items.find((row) => row.id === current.id)
          : undefined,
      );
      setConfirmDelete(false);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
      load();
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function edit(item: UpcomingItem) {
    setOpen(undefined);
    setMenu(undefined);
    onEdit(editDraft(item));
  }

  if (!connected)
    return (
      <Empty title={t("Upcoming tasks")} icon={<CalendarClock size={28} />}>
        <p>{t("Connect to see your reminders and recurring tasks.")}</p>
      </Empty>
    );
  const rows = snapshot ? upcomingRows(snapshot.items, Date.now()) : [];
  return (
    <div className="upcoming-tab">
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {snapshot && !rows.length && (
        <Empty title={t("Upcoming tasks")} icon={<CalendarClock size={28} />}>
          <p>
            {t(
              "Ask in chat to be reminded of something or to have a task done on a schedule. It will appear here.",
            )}
          </p>
        </Empty>
      )}
      <ul className="upcoming-list">
        {rows.map(({ item, next }) => (
          <li key={item.id}>
            <button
              className={item.status === "paused" ? "paused" : ""}
              onClick={() => {
                setConfirmDelete(false);
                setOpen(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ item, x: event.clientX, y: event.clientY });
              }}
            >
              <strong>{item.title}</strong>
              <span>{describeSchedule(item, formatLocale())}</span>
              <small>{when(next)}</small>
            </button>
          </li>
        ))}
      </ul>
      <footer className="upcoming-delivery">
        {supported && (
          <div className="settings-group">
            <Switch
              label={t("Deliver even when Open Muse is closed")}
              checked={delivery?.enabled ?? false}
              disabled={!delivery || deliveryBusy}
              onChange={(value) => void toggleDelivery(value)}
            />
          </div>
        )}
        <p>
          {delivery?.enabled
            ? delivery.state === "session_unavailable"
              ? t(
                  "The Muse service can no longer reach your main chat. Open the main chat to register it again.",
                )
              : t(
                  "The Muse service sends due reminders to your main chat even when the app is closed, and your agent handles them with its tools. Steps that need approval wait for you. There are no push notifications yet.",
                )
            : supported
              ? t(
                  "Reminders arrive in the main chat when Open Muse is open at or after their time. Turn on delivery while closed to let the Muse service use your saved Ark key to run them while you are away; each one is a real Ark request and may be billed. There are no push notifications yet.",
                )
              : t(
                  "Reminders arrive in the main chat when Open Muse is open at or after their time. There are no push notifications yet.",
                )}
        </p>
      </footer>
      {menu && (
        <div
          className="status-menu upcoming-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => edit(menu.item)}>
            <Pencil size={15} />
            {t("Edit")}
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              const target = menu.item;
              setMenu(undefined);
              void change(
                target,
                target.status === "paused" ? "resume" : "pause",
              );
            }}
          >
            {menu.item.status === "paused" ? (
              <Play size={15} />
            ) : (
              <Pause size={15} />
            )}
            {menu.item.status === "paused" ? t("Resume") : t("Pause")}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(menu.item);
              setConfirmDelete(true);
              setMenu(undefined);
            }}
          >
            <Trash2 size={15} />
            {t("Remove")}
          </button>
        </div>
      )}
      {open && (
        <Modal
          title={open.title}
          className="upcoming-dialog"
          onClose={() => !busy && setOpen(undefined)}
        >
          <dl>
            <dt>{t("Schedule")}</dt>
            <dd>{describeSchedule(open, formatLocale())}</dd>
            <dt>{t("Next")}</dt>
            <dd>{when(nextOccurrence(open, Date.now()))}</dd>
            {open.instruction && (
              <>
                <dt>{t("What happens")}</dt>
                <dd>{open.instruction}</dd>
              </>
            )}
          </dl>
          {confirmDelete ? (
            <div className="feed-dialog-actions">
              <p>{t("Remove “{title}”?", { title: open.title })}</p>
              <button
                className="pill-button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="pill-button danger"
                disabled={busy}
                onClick={() => void change(open, "delete")}
              >
                {t("Remove")}
              </button>
            </div>
          ) : (
            <div className="feed-dialog-actions">
              <button
                className="pill-button"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                {t("Remove")}
              </button>
              <button
                className="pill-button"
                disabled={busy}
                onClick={() =>
                  void change(
                    open,
                    open.status === "paused" ? "resume" : "pause",
                  )
                }
              >
                {open.status === "paused" ? t("Resume") : t("Pause")}
              </button>
              <button
                className="pill-button primary"
                onClick={() => edit(open)}
              >
                <Pencil size={15} />
                {t("Edit")}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
