import { useEffect, useState } from "react";
import {
  Bell,
  Goal,
  LoaderCircle,
  MessageCircle,
  MessageCircleHeart,
  Send,
  Webhook,
} from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import type { Notice, NoticeKind } from "../shared/notices";
import type { Client } from "./api";
import { Sheet } from "./MusePages";
import "./notices-sheet.css";

const kinds: Record<NoticeKind, { label: string; icon: typeof Bell }> = {
  reminder: { label: "Reminder", icon: Bell },
  "check-in": { label: "Check-in", icon: MessageCircleHeart },
  goal: { label: "Goal follow-up", icon: Goal },
  lark: { label: "Lark message", icon: Send },
  event: { label: "Webhook event", icon: Webhook },
  reply: { label: "Reply", icon: MessageCircle },
};

// When a notice came, as the system lists do: the time today, else the date.
export function noticeTime(at: string, now = new Date()) {
  const date = new Date(at);
  const today = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    formatLocale(),
    today
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(date);
}

// What happened while the person was not watching, newest first; each opens
// the conversation it happened in. Opening the list marks it read.
export function NoticesSheet({
  client,
  onClose,
  onOpen,
}: {
  client: Client;
  onClose: () => void;
  onOpen: (notice: Notice) => void;
}) {
  const [list, setList] = useState<Notice[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void client
      .notices(abort.signal)
      .then(async ({ list }) => {
        if (abort.signal.aborted) return;
        setList(list);
        if (list[0]) await client.markNotices("read", list[0].at);
      })
      .catch((failure: Error) => {
        if (!abort.signal.aborted) setError(failure.message);
      });
    return () => abort.abort();
  }, [client]);
  async function clear() {
    if (!list?.[0]) return;
    await client.markNotices("cleared", list[0].at);
    setList([]);
  }
  return (
    <Sheet title={t("Notifications")} onClose={onClose} grouped>
      {error && (
        <p className="settings-footnote" role="alert">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="notices-loading" role="status">
          <LoaderCircle className="spin" size={18} />
        </p>
      )}
      {list && !list.length && (
        <div className="notices-empty">
          <Bell size={28} />
          <h3>{t("No notifications")}</h3>
          <p>
            {t(
              "Reminders, check-ins, goal follow-ups, incoming messages, and replies that finish while you are away appear here.",
            )}
          </p>
        </div>
      )}
      {list && list.length > 0 && (
        <>
          <ul className="settings-list notices-list">
            {list.map((notice) => {
              const { label, icon: Icon } = kinds[notice.kind];
              return (
                <li key={notice.id}>
                  <button
                    className="settings-list-row notice-row"
                    onClick={() => onOpen(notice)}
                  >
                    <span aria-hidden="true">
                      <Icon size={20} strokeWidth={2} />
                    </span>
                    <span className="settings-row-text">
                      <span className="notice-heading">
                        <strong>{t(label)}</strong>
                        <time dateTime={notice.at}>
                          {noticeTime(notice.at)}
                        </time>
                      </span>
                      <small>{notice.preview}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <ul className="settings-list notices-actions">
            <li>
              <button
                className="settings-list-row notices-clear"
                onClick={() =>
                  void clear().catch((e: Error) => setError(e.message))
                }
              >
                <span>{t("Clear all")}</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </Sheet>
  );
}
