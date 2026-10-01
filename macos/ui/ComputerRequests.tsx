import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../shared/types";
import {
  computerAvailable,
  computerChanged,
  describeCall,
  macSwitch,
  readComputer,
  type MacSwitch,
  type ComputerState,
} from "./computer";
import type { SettingsSectionId } from "./settings";

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
  onSettings: (section: SettingsSectionId) => void;
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
  // Calendar and location reads follow their own connector switches;
  // everything else needs computer use. The card offers to allow only when
  // every call can run, and points to the first switch that is off.
  const on: Record<MacSwitch, boolean> = {
    computer: state?.enabled ?? false,
    calendar: state?.calendar.enabled ?? false,
    location: state?.location.enabled ?? false,
  };
  const off = [...new Set(calls.map((call) => macSwitch(call.name)))].find(
    (kind) => !on[kind],
  );
  const enabled = !off;
  const settingsSection: SettingsSectionId =
    off === "computer" ? "computer-use" : "connectors";
  const offText: Record<MacSwitch, string> = {
    computer: t(
      "Computer use is off on this Mac. Turn it on in Settings, or decline.",
    ),
    calendar: t(
      "Calendar and Reminders are off on this Mac. Turn them on in Settings, or decline.",
    ),
    location: t(
      "Location is off on this Mac. Turn it on in Settings, or decline.",
    ),
  };
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
      {off && <p className="computer-off">{offText[off]}</p>}
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
          <button
            className="pill-button primary"
            onClick={() => onSettings(settingsSection)}
          >
            {t("Open Settings")}
          </button>
        )}
      </div>
    </section>
  );
}
