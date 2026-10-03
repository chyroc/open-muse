import { useId, useState } from "react";
import {
  BookUser,
  CalendarDays,
  Check,
  ListTodo,
  LoaderCircle,
  X,
} from "lucide-react";
import { formatLocale, t } from "../shared/i18n";
import {
  iphoneDeclined,
  iphoneInvalid,
  iphoneSource,
  parseIphoneRequest,
  type IphoneRequest,
} from "../shared/iphone-tools";
import type { AgentEvent } from "../shared/types";
import type { Client } from "./api";
import { personalSupported, readPersonal } from "./personal";

const day = (text?: string) => {
  const date = text ? new Date(text) : undefined;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(formatLocale(), {
        month: "short",
        day: "numeric",
      })
    : undefined;
};

// What one request reads, as the card and the approvals history name it.
export function describeIphoneRequest(request: IphoneRequest) {
  if (request.source === "contacts")
    return t("Contacts matching “{query}”", { query: request.query ?? "" });
  if (request.source === "reminders")
    return day(request.to)
      ? t("Open reminders due by {date}", { date: day(request.to)! })
      : t("All open reminders");
  const from = day(request.from) ?? t("Today");
  const to = day(request.to);
  return to
    ? t("Calendar events, {from} – {to}", { from, to })
    : t("Calendar events for 7 days from {from}", { from });
}

const icons = {
  calendar: CalendarDays,
  reminders: ListTodo,
  contacts: BookUser,
};
const titles = {
  calendar: "Share calendar events?",
  reminders: "Share reminders?",
  contacts: "Share contact details?",
};

// One card per pending iphone_* call. The person approves each one; only
// then is the source read on this iPhone and the result returned. Declining
// tells the agent not to try another way.
export function PersonalRequestCard({
  client,
  session,
  event,
  name,
  onAnswered,
}: {
  client: Client;
  session: string;
  event: AgentEvent;
  name: string;
  onAnswered: () => void;
}) {
  const id = useId();
  const request = parseIphoneRequest(event);
  const supported = personalSupported();
  const [busy, setBusy] = useState<"share" | "decline">();
  const [error, setError] = useState("");
  const source = request ? iphoneSource(request) : "calendar";
  const Icon = icons[source];
  async function answer(choice: "share" | "decline") {
    if (busy) return;
    setBusy(choice);
    setError("");
    try {
      let text = iphoneDeclined;
      let failed = true;
      if (!request) text = iphoneInvalid;
      else if (choice === "share") {
        try {
          text = await readPersonal(request);
          failed = /^\{"error":/.test(text) || /"ok":false/.test(text);
        } catch (reason) {
          // A failed read is reported to the agent, never retried here.
          text = `The iPhone could not read this: ${(reason as Error).message}`;
        }
      }
      await client.answerCustomTools(session, [
        {
          custom_tool_use_id: event.id,
          is_error: failed,
          content: [{ type: "text", text }],
        },
      ]);
      onAnswered();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <section
      className="permission-card health-card"
      aria-labelledby={`${id}-title`}
      aria-busy={Boolean(busy)}
    >
      <header className="permission-heading">
        <span className="permission-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="permission-heading-copy">
          <h3 id={`${id}-title`}>{t(titles[source])}</h3>
          <code>
            {request ? describeIphoneRequest(request) : t("Invalid request")}
          </code>
        </div>
      </header>
      <p className="permission-description">
        {!request
          ? t("{name} sent a request this app cannot read.", { name })
          : supported
            ? t(
                "{name} asked to read this on your iPhone. Only what matches is shared with your MA agent, and only this time.",
                { name },
              )
            : t(
                "{name} asked to read this on your iPhone. Open Open Muse on your iPhone to share it.",
                { name },
              )}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <footer className="permission-footer">
        <div className="permission-actions">
          <button
            type="button"
            className="button subtle"
            disabled={Boolean(busy)}
            onClick={() => void answer("decline")}
          >
            {busy === "decline" ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <X size={16} aria-hidden="true" />
            )}
            {request ? t("Don’t share") : t("Dismiss")}
          </button>
          {request && supported && (
            <button
              type="button"
              className="button primary"
              disabled={Boolean(busy)}
              onClick={() => void answer("share")}
            >
              {busy === "share" ? (
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              {busy === "share" ? t("Reading…") : t("Share")}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
