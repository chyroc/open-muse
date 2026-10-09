import { CalendarClock } from "lucide-react";
import { formatLocale, t } from "../../shared/i18n";
import { describeSchedule, type UpcomingItem } from "../../shared/upcoming";

// A reminder the companion just set up, in a card of its own under the reply:
// what it is about, when it comes, and a way to the Upcoming list.
export function ReminderCard({
  item,
  onOpen,
}: {
  item: UpcomingItem;
  onOpen: () => void;
}) {
  return (
    <div className="mac-reminder-card">
      <div className="mac-reminder-head">
        <span className="mac-reminder-icon" aria-hidden="true">
          <CalendarClock size={18} strokeWidth={1.8} />
        </span>
        <div>
          <strong>{item.title}</strong>
          <small>{t("Reminder")}</small>
        </div>
      </div>
      <p>{describeSchedule(item, formatLocale())}</p>
      <button type="button" className="mac-reminder-open" onClick={onOpen}>
        {t("Open Upcoming")}
      </button>
    </div>
  );
}
