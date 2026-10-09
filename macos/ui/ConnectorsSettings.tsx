import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Brain,
  CalendarDays,
  Globe,
  MapPin,
  HeartPulse,
  Laptop,
  MessagesSquare,
  Search,
  SquareTerminal,
  ChevronRight,
} from "lucide-react";
import { t } from "../../shared/i18n";
import { AppIcon, hasAppIcon } from "../../src/AppIcons";
import { backgroundClient } from "../../src/background-client";
import { LarkSetupPanel, useLarkAccount } from "./LarkSetup";
import { Switch } from "./SettingsSwitch";
import {
  computerAvailable,
  computerChanged,
  enableCalendar,
  enableLocation,
  readAppIcons,
  readComputer,
  requestCalendar,
  requestLocation,
  type CalendarPermission,
  type ComputerState,
} from "./computer";

// The installed apps' own icons; the Mac app keeps them once it has drawn them.
export function useAppIcons() {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void readAppIcons().then((value) => alive && setIcons(value));
    return () => {
      alive = false;
    };
  }, []);
  return icons;
}

// A connector's icon: the app it stands for, from this Mac when it is
// installed, otherwise a glyph on a plain tile.
export function ConnectorIcon({
  id,
  Icon,
  icons,
}: {
  id: string;
  Icon?: typeof Globe;
  icons: Record<string, string>;
}) {
  if (icons[id])
    return (
      <img
        className="connector-app-icon"
        src={icons[id]}
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
      />
    );
  // Not installed here, or with no Mac app at all, such as Apple Health: the
  // app's official icon that the iPhone shows.
  if (hasAppIcon(id))
    return (
      <span className="connector-app-icon bundled" aria-hidden="true">
        <AppIcon id={id} />
      </span>
    );
  return (
    <span className="connector-tile" aria-hidden="true">
      {Icon && <Icon size={18} strokeWidth={1.7} />}
    </span>
  );
}

// Local connectors on this Mac: Calendar and Reminders, and Location. Each is
// off until turned on here, only reads, and every read still waits for
// approval in the conversation.
function LocalConnectors({ term }: { term: string }) {
  const icons = useAppIcons();
  const [state, setState] = useState<ComputerState>();
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      void readComputer()
        .then((value) => value && setState(value))
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
  const change = (request: Promise<ComputerState | undefined>) =>
    void request
      .then((value) => value && setState(value))
      .catch(() => setError(t("Could not change the app settings.")));
  const permission = (
    title: string,
    value: CalendarPermission | undefined,
    request: () => Promise<ComputerState | undefined>,
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
          onClick={() => change(request())}
        >
          {value === "denied" ? t("Open System Settings") : t("Allow")}
        </button>
      )}
    </div>
  );
  const calendar = {
    name: t("Calendar and Reminders"),
    detail: t(
      "Your assistant can read your events and open reminders on this Mac when you ask. It never changes them, and each read waits for your approval.",
    ),
  };
  const location = {
    name: t("Location"),
    detail: t(
      "Your assistant can find this Mac's approximate location when the answer depends on where you are. Each lookup waits for your approval.",
    ),
  };
  const shown = (item: { name: string; detail: string }) =>
    !term || `${item.name} ${item.detail}`.toLocaleLowerCase().includes(term);
  if (!shown(calendar) && !shown(location)) return null;
  return (
    <>
      <h2>{t("On this Mac")}</h2>
      <div className="settings-group">
        {shown(calendar) && (
          <>
            <Switch
              label={calendar.name}
              detail={calendar.detail}
              icon={
                <ConnectorIcon
                  id="calendar"
                  Icon={CalendarDays}
                  icons={icons}
                />
              }
              checked={state?.calendar.enabled ?? false}
              disabled={!state}
              onChange={(value) => change(enableCalendar(value))}
            />
            {state?.calendar.enabled && (
              <>
                {permission(t("Calendar"), state.calendar.events, () =>
                  requestCalendar("events"),
                )}
                {permission(t("Reminders"), state.calendar.reminders, () =>
                  requestCalendar("reminders"),
                )}
              </>
            )}
          </>
        )}
        {shown(location) && (
          <>
            <Switch
              label={location.name}
              detail={location.detail}
              icon={<ConnectorIcon id="location" Icon={MapPin} icons={icons} />}
              checked={state?.location.enabled ?? false}
              disabled={!state}
              onChange={(value) => change(enableLocation(value))}
            />
            {state?.location.enabled &&
              permission(
                t("Location Services"),
                state.location.permission,
                requestLocation,
              )}
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
  // A connection the person sets up themselves; it is listed as available
  // until they do.
  connect?: boolean;
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
    connect: true,
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
  name = t("Your assistant"),
  service = backgroundClient,
}: {
  onSection: (id: string) => void;
  // The companion's name, for the Lark setup steps.
  name?: string;
  service?: typeof backgroundClient;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const icons = useAppIcons();
  // Lark is connected through the Open Muse service, as on iPhone.
  const lark = useLarkAccount(service);
  const [larkSetup, setLarkSetup] = useState(false);
  useEffect(lark.read, []);
  const term = query.trim().toLocaleLowerCase();
  const items = connectors()
    .map((item) =>
      item.id === "lark" && lark.account && lark.account !== "unknown"
        ? {
            ...item,
            connect: false,
            detail: lark.account.name
              ? t(
                  "Connected as {name}. Your assistant works in Lark as you in every conversation.",
                  { name: lark.account.name },
                )
              : t(
                  "Connected. Your assistant works in Lark as you in every conversation.",
                ),
          }
        : item,
    )
    .filter(
      (item) =>
        !term ||
        `${item.name} ${item.detail}`.toLocaleLowerCase().includes(term),
    );
  const disconnect = () =>
    void service.removeLarkState().then(
      () => lark.setAccount(undefined),
      (reason: Error) => setError(reason.message),
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
      {(
        [
          [t("Connected"), items.filter((item) => !item.connect)],
          [t("Available"), items.filter((item) => item.connect)],
        ] as [string, Connector[]][]
      ).map(
        ([heading, group]) =>
          group.length > 0 && (
            <section key={heading}>
              <h2>{heading}</h2>
              <div className="settings-group">
                {group.map(
                  ({ id, name: title, detail, Icon, connect, section }) => (
                    <Fragment key={id}>
                      <div className="settings-row settings-device-row connector-row">
                        <ConnectorIcon id={id} Icon={Icon} icons={icons} />
                        <div>
                          <strong>{title}</strong>
                          <p>{detail}</p>
                        </div>
                        {connect ? (
                          !larkSetup && (
                            <button
                              className="settings-link"
                              disabled={lark.account === "unknown"}
                              onClick={() => {
                                setError("");
                                setLarkSetup(true);
                              }}
                            >
                              {t("Connect")}
                            </button>
                          )
                        ) : id === "lark" ? (
                          <button
                            className="settings-inline-button danger"
                            onClick={disconnect}
                          >
                            {t("Disconnect")}
                          </button>
                        ) : (
                          section && (
                            <button
                              className="connector-open icon-button"
                              onClick={() => onSection(section)}
                            >
                              <ChevronRight size={18} aria-hidden="true" />
                              <span className="sr-only">{t("Settings")}</span>
                            </button>
                          )
                        )}
                      </div>
                      {id === "lark" && connect && larkSetup && (
                        <LarkSetupPanel
                          name={name}
                          service={service}
                          onCancel={() => setLarkSetup(false)}
                          onConnected={(value) => {
                            setLarkSetup(false);
                            lark.setAccount({ name: value.name });
                          }}
                        />
                      )}
                    </Fragment>
                  ),
                )}
              </div>
            </section>
          ),
      )}
      {!items.length && (
        <div className="settings-group settings-gap">
          <div className="settings-row">
            <div>
              <p>{t("No results")}</p>
            </div>
          </div>
        </div>
      )}
      {computerAvailable() && <LocalConnectors term={term} />}
      {error && (
        <p className="settings-error settings-after" role="alert">
          {error}
        </p>
      )}
      <p className="settings-lead settings-after">
        {t(
          "Other services are not connected in this app. Ask your assistant in chat; it can often use a service's website or command-line tool instead.",
        )}
      </p>
    </>
  );
}
