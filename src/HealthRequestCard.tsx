import { useId, useState } from "react";
import { Check, HeartPulse, LoaderCircle, X } from "lucide-react";
import { t } from "../shared/i18n";
import {
  healthDeclined,
  healthInvalid,
  healthMetricLabel,
  healthRangeLabel,
  parseHealthRequest,
} from "../shared/health";
import type { AgentEvent } from "../shared/types";
import type { Client } from "./api";
import { healthSupported, readHealth } from "./health";

// One card per pending health_read call. Data leaves the device only after
// the person taps Share; declining answers the call without any data.
export function HealthRequestCard({
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
  const query = parseHealthRequest(event);
  const supported = healthSupported();
  const [busy, setBusy] = useState<"share" | "decline">();
  const [error, setError] = useState("");
  async function answer(choice: "share" | "decline") {
    if (busy) return;
    setBusy(choice);
    setError("");
    try {
      let text = choice === "share" ? "" : healthDeclined;
      let failed = choice !== "share";
      if (!query) text = healthInvalid;
      else if (choice === "share") {
        try {
          text = await readHealth(query);
        } catch (reason) {
          // A HealthKit failure is reported to the agent, never retried here.
          text = `Apple Health could not be read: ${(reason as Error).message}`;
          failed = true;
        }
      }
      await client.answerCustomTools(session, [
        {
          custom_tool_use_id: event.id,
          is_error: failed || !query,
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
          <HeartPulse size={19} aria-hidden="true" />
        </span>
        <div className="permission-heading-copy">
          <h3 id={`${id}-title`}>{t("Share Apple Health data?")}</h3>
          <code>
            {query
              ? `${healthMetricLabel(query.metric)} · ${healthRangeLabel(query)}`
              : t("Invalid request")}
          </code>
        </div>
      </header>
      <p className="permission-description">
        {!query
          ? t("{name} sent a request this app cannot read.", { name })
          : supported
            ? t(
                "{name} asked to read this from Apple Health. Only this summary is shared with your MA agent.",
                { name },
              )
            : t(
                "{name} asked to read this from Apple Health. Open Open Muse on your iPhone to share it.",
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
            {query ? t("Don’t share") : t("Dismiss")}
          </button>
          {query && supported && (
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
