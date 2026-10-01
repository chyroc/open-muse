import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../shared/types";
import {
  computerAvailable,
  computerChanged,
  describeCall,
  readComputer,
  type ComputerState,
} from "./computer";

export type MacAnswer = "once" | "chat" | "deny";

// The agent is waiting for this Mac. Each pending call says what it will do,
// and nothing runs until the person answers.
export function ComputerRequests({
  calls,
  busy,
  onAnswer,
  onSettings,
}: {
  calls: AgentEvent[];
  busy: boolean;
  onAnswer: (answer: MacAnswer) => void;
  onSettings: () => void;
}) {
  const [state, setState] = useState<ComputerState>();
  useEffect(() => {
    if (!computerAvailable()) return;
    let alive = true;
    const refresh = () =>
      void readComputer()
        .then((value) => alive && value && setState(value))
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(computerChanged, refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(computerChanged, refresh);
    };
  }, []);
  const enabled = state?.enabled ?? false;
  return (
    <section
      className="computer-requests"
      role="alertdialog"
      aria-label={t("Your assistant wants to use this Mac")}
    >
      <header>
        <MonitorSmartphone size={17} />
        <strong>{t("Your assistant wants to use this Mac")}</strong>
      </header>
      <ul>
        {calls.map((call) => (
          <li key={call.id}>{describeCall(call)}</li>
        ))}
      </ul>
      {!enabled && (
        <p className="computer-off">
          {t(
            "Computer use is off on this Mac. Turn it on in Settings, or decline.",
          )}
        </p>
      )}
      <div className="computer-actions">
        <button
          className="pill-button"
          disabled={busy}
          onClick={() => onAnswer("deny")}
        >
          {t("Decline")}
        </button>
        {enabled ? (
          <>
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => onAnswer("chat")}
            >
              {t("Allow in this chat")}
            </button>
            <button
              className="pill-button primary"
              disabled={busy}
              onClick={() => onAnswer("once")}
            >
              {t("Allow once")}
            </button>
          </>
        ) : (
          <button className="pill-button primary" onClick={onSettings}>
            {t("Open Settings")}
          </button>
        )}
      </div>
    </section>
  );
}
