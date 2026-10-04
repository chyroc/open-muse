import { Bell } from "lucide-react";
import { formatLocale } from "../shared/i18n";
import { describeSchedule, type UpcomingItem } from "../shared/upcoming";
import "./reminder-card.css";

// A reminder the companion just set up, under its reply: what it is about
// and when it comes.
export function ReminderCard({ item }: { item: UpcomingItem }) {
  return (
    <div className="reminder-card">
      <strong>{item.title}</strong>
      <span>
        <Bell size={13} strokeWidth={2.2} aria-hidden="true" />
        {describeSchedule(item, formatLocale())}
      </span>
    </div>
  );
}
