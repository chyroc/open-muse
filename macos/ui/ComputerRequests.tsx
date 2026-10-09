import { useEffect, useState } from "react";
import {
  CalendarDays,
  ListChecks,
  MapPin,
  MonitorSmartphone,
} from "lucide-react";
import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../shared/types";
import {
  computerAvailable,
  computerChanged,
  describeCall,
  enableCalendar,
  enableLocation,
  enableReminders,
  macSwitch,
  readComputer,
  type MacSwitch,
  type ComputerState,
} from "./computer";
import { ConnectorIcon, useAppIcons } from "./ConnectorsSettings";
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
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState("");
  const icons = useAppIcons();
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
  // Calendar, Reminders and Location reads follow their own connector
  // switches; everything else needs computer use. The card offers to allow
  // only when every call can run, and points to the first switch that is off.
  const on: Record<MacSwitch, boolean> = {
    computer: state?.enabled ?? false,
    calendar: state?.calendar.enabled ?? false,
    reminders: state?.calendar.remindersEnabled ?? false,
    location: state?.location.enabled ?? false,
  };
  const off = [
    ...new Set(calls.map((call) => macSwitch(call.name, call.input))),
  ].find((kind) => !on[kind]);
  const enabled = !off;
  const settingsSection: SettingsSectionId =
    off === "computer" ? "computer-use" : "connectors";
  // Calendar, Reminders and Location are connectors on this Mac: when one is
  // off, the card offers to connect it right here, which also asks macOS for
  // access, and the calls then wait for the usual approval.
  const connector = off && off !== "computer" ? off : undefined;
  const connectors = {
    calendar: {
      name: t("Calendar"),
      Icon: CalendarDays,
      detail: t(
        "Connect to let your assistant read your calendar on this Mac. Each read still waits for your approval.",
      ),
    },
    reminders: {
      name: t("Reminders"),
      Icon: ListChecks,
      detail: t(
        "Connect to let your assistant read your open reminders on this Mac. Each read still waits for your approval.",
      ),
    },
    location: {
      name: t("Location"),
      Icon: MapPin,
      detail: t(
        "Connect to let your assistant find this Mac's approximate location. Each lookup still waits for your approval.",
      ),
    },
  };
  async function connect() {
    if (!connector || connecting) return;
    setConnecting(true);
    setFailure("");
    try {
      const next = await (
        connector === "calendar"
          ? enableCalendar
          : connector === "reminders"
            ? enableReminders
            : enableLocation
      )(true);
      if (next) setState(next);
    } catch {
      setFailure(t("Couldn't connect. Try again in Settings > Connectors."));
    } finally {
      setConnecting(false);
    }
  }
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
      {connector ? (
        <div className="computer-connector">
          <ConnectorIcon
            id={connector}
            Icon={connectors[connector].Icon}
            icons={icons}
          />
          <div>
            <strong>{connectors[connector].name}</strong>
            <small>{connectors[connector].detail}</small>
          </div>
        </div>
      ) : (
        off && (
          <p className="computer-off">
            {t(
              "Computer use is off on this Mac. Turn it on in Settings, or decline.",
            )}
          </p>
        )
      )}
      {failure && (
        <p className="computer-off" role="alert">
          {failure}
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
        ) : connector ? (
          <button
            className="pill-button primary"
            disabled={busy || connecting}
            onClick={() => void connect()}
          >
            {t("Connect")}
          </button>
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
