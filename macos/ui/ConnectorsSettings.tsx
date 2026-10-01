import { useCallback, useEffect, useState } from "react";
import {
  Brain,
  Globe,
  HeartPulse,
  Laptop,
  MessagesSquare,
  Search,
  SquareTerminal,
} from "lucide-react";
import { t } from "../../shared/i18n";
import { draftInMainChat } from "./dataExport";
import { Switch } from "./SettingsSwitch";
import {
  computerAvailable,
  computerChanged,
  enableCalendar,
  readComputer,
  requestCalendar,
  type CalendarPermission,
  type CalendarState,
} from "./computer";

// Calendar and Reminders on this Mac: off until turned on here, read only, and
// every read still waits for approval in the conversation.
function CalendarConnector({ term }: { term: string }) {
  const [state, setState] = useState<CalendarState>();
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      void readComputer()
        .then((value) => value && setState(value.calendar))
        .catch(() => setError(t("Could not read the app settings."))),
    [],
  );
  useEffect(() => {
    refresh();
    // Permissions are granted in System Settings, so re-read on return.
    window.addEventListener("focus", refresh);
    window.addEventListener(computerChanged, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(computerChanged, refresh);
    };
  }, [refresh]);
  const name = t("Calendar and Reminders");
  const detail = t(
    "Your assistant can read your events and open reminders on this Mac when you ask. It never changes them, and each read waits for your approval.",
  );
  if (term && !`${name} ${detail}`.toLocaleLowerCase().includes(term))
    return null;
  const change = (request: Promise<{ calendar: CalendarState } | undefined>) =>
    void request
      .then((value) => value && setState(value.calendar))
      .catch(() => setError(t("Could not change the app settings.")));
  const permission = (
    kind: "events" | "reminders",
    title: string,
    value?: CalendarPermission,
  ) => (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
      </div>
      {value === "allowed" ? (
        <span>{t("Allowed")}</span>
      ) : (
        <button
          className="settings-inline-button"
          disabled={!state}
          onClick={() => change(requestCalendar(kind))}
        >
          {value === "denied" ? t("Open System Settings") : t("Allow")}
        </button>
      )}
    </div>
  );
  return (
    <>
      <h2>{t("On this Mac")}</h2>
      <div className="settings-group">
        <Switch
          label={name}
          detail={detail}
          checked={state?.enabled ?? false}
          disabled={!state}
          onChange={(value) => change(enableCalendar(value))}
        />
        {state?.enabled && (
          <>
            {permission("events", t("Calendar"), state.events)}
            {permission("reminders", t("Reminders"), state.reminders)}
          </>
        )}
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

type Connector = {
  id: string;
  name: string;
  detail: string;
  Icon: typeof Globe;
  // A connection that needs the person's own sign-in starts as a chat draft.
  connect?: string;
  // Or it lives in another settings section.
  section?: string;
};

// What the assistant can reach, as provisioned by this app: the agent's own
// tools and environment, and the devices that answer its device tools.
export const connectors = (): Connector[] => [
  {
    id: "web",
    name: t("Web search and pages"),
    detail: t("Searches the web and reads pages you point to."),
    Icon: Search,
  },
  {
    id: "browser",
    name: t("Browser"),
    detail: t(
      "A Chrome browser in your assistant's own cloud environment, separate from yours.",
    ),
    Icon: Globe,
  },
  {
    id: "files",
    name: t("Files and commands"),
    detail: t(
      "Creates, edits and runs files in your assistant's cloud environment.",
    ),
    Icon: SquareTerminal,
  },
  {
    id: "lark",
    name: t("Lark"),
    detail: t(
      "The Lark command-line tool and its official skills, for messages, docs, calendar and more once you sign in.",
    ),
    Icon: MessagesSquare,
    connect:
      "Help me sign in to Lark with lark-cli so you can work in my Lark account.",
  },
  {
    id: "memory",
    name: t("Personal memory"),
    detail: t(
      "Your assistant's identity, persona and what it remembers about you.",
    ),
    Icon: Brain,
  },
  {
    id: "mac",
    name: t("This Mac"),
    detail: t(
      "Screen, apps, keyboard and files, with your approval each time.",
    ),
    Icon: Laptop,
    section: "computer-use",
  },
  {
    id: "health",
    name: t("Apple Health"),
    detail: t("Read from your iPhone when you share a request there."),
    Icon: HeartPulse,
  },
];

export function ConnectorsSettings({
  onSection,
}: {
  onSection: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const items = connectors().filter(
    (item) =>
      !term || `${item.name} ${item.detail}`.toLocaleLowerCase().includes(term),
  );
  return (
    <>
      <label className="search-field settings-search">
        <Search size={16} />
        <input
          value={query}
          placeholder={t("Search connectors")}
          aria-label={t("Search connectors")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="settings-group">
        {items.map(({ id, name, detail, Icon, connect, section }) => (
          <div className="settings-row settings-device-row" key={id}>
            <Icon size={17} />
            <div>
              <strong>{name}</strong>
              <p>{detail}</p>
            </div>
            {connect ? (
              <button
                className="settings-inline-button"
                onClick={() =>
                  setNotice(
                    draftInMainChat(t(connect))
                      ? t("A draft is waiting in the main chat.")
                      : t("Open the Mac app to continue."),
                  )
                }
              >
                {t("Connect")}
              </button>
            ) : section ? (
              <button
                className="settings-inline-button"
                onClick={() => onSection(section)}
              >
                {t("Settings")}
              </button>
            ) : (
              <span>{t("Included")}</span>
            )}
          </div>
        ))}
        {!items.length && (
          <div className="settings-row">
            <div>
              <p>{t("No results")}</p>
            </div>
          </div>
        )}
      </div>
      {computerAvailable() && <CalendarConnector term={term} />}
      {notice && <p className="settings-lead settings-after">{notice}</p>}
      <p className="settings-lead settings-after">
        {t(
          "Other services are not connected in this app. Ask your assistant in chat; it can often use a service's website or command-line tool instead.",
        )}
      </p>
    </>
  );
}
