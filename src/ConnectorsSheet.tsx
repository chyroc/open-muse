import { useEffect, useState } from "react";
import { ConnectorIcon } from "./AppIcons";
import {
  BookUser,
  Brain,
  CalendarDays,
  ChevronRight,
  Globe,
  HeartPulse,
  ListTodo,
  LoaderCircle,
  MessagesSquare,
  Search,
  SquareTerminal,
} from "lucide-react";
import { t } from "../shared/i18n";
import { onAndroid } from "./platform";
import type { Client } from "./api";
import { connectHealth, healthAccess } from "./health";
import { PersonalConnectSheet } from "./PersonalConnectSheet";
import { LarkConnectSheet } from "./LarkConnectSheet";
import { backgroundClient, type BackgroundClient } from "./background-client";
import {
  connectPersonal,
  personalAccess,
  personalSources,
  type PersonalAccess,
} from "./personal";
import type { IphoneSource } from "../shared/iphone-tools";
import { Sheet } from "./MusePages";
import "./connectors.css";

type Connector = {
  id: string;
  name: string;
  detail: string;
  Icon: typeof Globe;
};

// What the assistant can reach in this app: tools included in its own cloud
// environment, Apple Health on this iPhone, and Lark once the person signs in.
const included = (): Connector[] => [
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
    id: "memory",
    name: t("Personal memory"),
    detail: t(
      "Your assistant's identity, persona and what it remembers about you.",
    ),
    Icon: Brain,
  },
];
const health = (): Connector => ({
  id: "health",
  name: onAndroid() ? t("Health Connect") : t("Apple Health"),
  detail: onAndroid()
    ? t(
        "Your assistant reads it when you ask about activity, workouts, sleep, heart rate or weight. Change what it can read in Health Connect.",
      )
    : t(
        "Your assistant reads it when you ask about activity, workouts, sleep, heart rate or weight. Change what it can read in the Health app.",
      ),
  Icon: HeartPulse,
});
const lark = (): Connector => ({
  id: "lark",
  name: t("Lark"),
  detail: t(
    "The Lark command-line tool and its official skills, for messages, docs, calendar and more once you sign in.",
  ),
  Icon: MessagesSquare,
});
// Calendar, Reminders, and Contacts on this iPhone. Each read is approved in
// the chat; connecting only asks iOS for access ahead of the first one.
const personal = (source: IphoneSource): Connector =>
  ({
    calendar: {
      id: "calendar",
      name: t("Calendar"),
      detail: onAndroid()
        ? t(
            "Your assistant asks before reading the events on this phone. Change access in Android Settings > Apps > Open Muse.",
          )
        : t(
            "Your assistant asks before reading the events on your iPhone. Change access in iOS Settings > Open Muse.",
          ),
      Icon: CalendarDays,
    },
    reminders: {
      id: "reminders",
      name: t("Reminders"),
      detail: t(
        "Your assistant asks before reading your open reminders. Change access in iOS Settings > Open Muse.",
      ),
      Icon: ListTodo,
    },
    contacts: {
      id: "contacts",
      name: t("Contacts"),
      detail: onAndroid()
        ? t(
            "Your assistant asks before looking up the people you mention. Change access in Android Settings > Apps > Open Muse.",
          )
        : t(
            "Your assistant asks before looking up the people you mention. Change access in iOS Settings > Open Muse.",
          ),
      Icon: BookUser,
    },
  })[source];
// Signed in from a conversation with lark-cli: the account keeps that
// sign-in for new conversations.
const larkSignedIn = (): Connector => ({
  ...lark(),
  detail: t(
    "Signed in to your Lark account. Your assistant keeps this sign-in for new conversations.",
  ),
});
// Connected in the app: the service keeps the person's authorization.
const larkAuthorized = (name?: string): Connector => ({
  ...lark(),
  detail: name
    ? t(
        "Connected as {name}. Your assistant works in Lark as you in every conversation.",
        { name },
      )
    : t(
        "Connected. Your assistant works in Lark as you in every conversation.",
      ),
});
const larkSignOut = "Sign me out of Lark with lark-cli.";

export function ConnectorsSheet({
  client,
  name,
  onClose,
  onDraft,
  service = backgroundClient,
}: {
  // The companion's name, for the connect sheets.
  name?: string;
  // Whether this identity connected Apple Health on this device.
  // and whether the assistant is signed in to Lark in the main chat.
  client: Pick<
    Client,
    "healthConnected" | "setHealthConnected" | "larkConnected" | "forgetLark"
  >;
  onClose: () => void;
  // Puts text in the main chat composer for the person to review and send.
  onDraft: (text: string) => void;
  // The Open Muse service, which sets up Lark for an account.
  service?: Pick<BackgroundClient, "larkConnection" | "startLarkConnection">;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string>();
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof healthAccess>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linked, setLinked] = useState(false);
  const [larkLinked, setLarkLinked] = useState(false);
  // The Lark connection the service set up, by the person's Lark name.
  const [larkAccount, setLarkAccount] = useState<{ name?: string }>();
  const [larkSetup, setLarkSetup] = useState(false);
  // iOS access for Calendar, Reminders, and Contacts, once read.
  const [personalState, setPersonalState] =
    useState<Partial<Record<IphoneSource, PersonalAccess>>>();
  const [connecting, setConnecting] = useState<IphoneSource>();
  const readPersonal = () =>
    Promise.all(
      personalSources().map(
        async (source) => [source, await personalAccess(source)] as const,
      ),
    ).then((entries) => setPersonalState(Object.fromEntries(entries)));
  useEffect(() => {
    let active = true;
    // What this device kept answers at once; the conversation's history
    // then has the final say.
    void client
      .larkConnected(true)
      .then((value) => {
        if (active) setLarkLinked(value);
        return client.larkConnected();
      })
      .then(
        (value) => active && setLarkLinked(value),
        () => {},
      );
    void service.larkConnection().then(
      (value) =>
        active &&
        setLarkAccount(
          value.phase === "connected" ? { name: value.name } : undefined,
        ),
      () => {},
    );
    void client.healthConnected().then(
      (value) => active && setLinked(value),
      () => {},
    );
    void readPersonal().catch(() => {});
    void healthAccess()
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch(() => {
        if (active) setAccess("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  async function connect(id: string) {
    setError("");
    if (id === "lark") {
      setLarkSetup(true);
      return;
    }
    if ((personalSources() as string[]).includes(id)) {
      setConnecting(id as IphoneSource);
      return;
    }
    setBusy(true);
    try {
      await connectHealth();
      await client.setHealthConnected(true);
      setLinked(true);
      setAccess(await healthAccess());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const term = query.trim().toLocaleLowerCase();
  const matches = (item: Connector) =>
    !term || `${item.name} ${item.detail}`.toLocaleLowerCase().includes(term);
  const healthItem = access && access !== "unavailable" ? [health()] : [];
  // Sources iOS has not refused yet can be connected; allowed ones are.
  const allowed = personalSources().filter(
    (source) => personalState?.[source] === "allowed",
  );
  const askable = personalSources().filter((source) =>
    ["not-asked", "denied"].includes(personalState?.[source] ?? ""),
  );
  const connected = [
    ...included(),
    ...(linked ? healthItem : []),
    ...allowed.map(personal),
    ...(larkAccount
      ? [larkAuthorized(larkAccount.name)]
      : larkLinked
        ? [larkSignedIn()]
        : []),
  ].filter(matches);
  const available = [
    ...(linked ? [] : healthItem),
    ...askable.map(personal),
    ...(larkAccount || larkLinked ? [] : [lark()]),
  ].filter(matches);
  return (
    <Sheet title={t("Connectors")} onClose={onClose} grouped>
      {larkSetup && (
        <LarkConnectSheet
          name={name ?? t("Your assistant")}
          service={service}
          onConnected={(value) => setLarkAccount({ name: value.name })}
          onClose={() => setLarkSetup(false)}
        />
      )}
      {connecting && (
        <PersonalConnectSheet
          source={connecting}
          name={name ?? t("Your assistant")}
          onClose={() => setConnecting(undefined)}
          onContinue={() =>
            void connectPersonal(connecting)
              .then((state) => {
                if (state === "denied")
                  setError(
                    onAndroid()
                      ? t(
                          "Android did not allow access. Turn it on in Android Settings > Apps > Open Muse.",
                        )
                      : t(
                          "iOS did not allow access. Turn it on in iOS Settings > Open Muse.",
                        ),
                  );
                return readPersonal();
              })
              .catch((reason: Error) => setError(reason.message))
          }
        />
      )}
      <div className="connectors">
        <label className="connector-search">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            placeholder={t("Search connectors")}
            aria-label={t("Search connectors")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {connected.length > 0 && (
          <>
            <h3>{t("Connected")}</h3>
            <ul className="connector-group">
              {connected.map(({ id, name, detail, Icon }) => (
                <li key={id}>
                  <button
                    className="connector-row"
                    aria-expanded={open === id}
                    onClick={() => setOpen(open === id ? undefined : id)}
                  >
                    <ConnectorIcon id={id} Icon={Icon} />
                    <span className="connector-name">{name}</span>
                    <ChevronRight
                      size={18}
                      className="connector-chevron"
                      aria-hidden="true"
                    />
                  </button>
                  {open === id && (
                    <div className="connector-detail">
                      <p>{detail}</p>
                      {id === "lark" && (
                        <button
                          type="button"
                          className="connector-disconnect"
                          onClick={() =>
                            void client.forgetLark().then(
                              () => {
                                // Authorization kept by the service ends at
                                // once; a sign-in in the chat signs out there.
                                if (larkAccount) {
                                  setLarkAccount(undefined);
                                  setLarkLinked(false);
                                  setOpen(undefined);
                                } else onDraft(t(larkSignOut));
                              },
                              (reason: Error) => setError(reason.message),
                            )
                          }
                        >
                          {t("Disconnect")}
                        </button>
                      )}
                      {id === "health" && (
                        <button
                          type="button"
                          className="connector-disconnect"
                          onClick={() =>
                            void client.setHealthConnected(false).then(
                              () => {
                                setLinked(false);
                                setOpen(undefined);
                              },
                              (reason: Error) => setError(reason.message),
                            )
                          }
                        >
                          {t("Disconnect")}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {available.length > 0 && (
          <>
            <h3>{t("Available")}</h3>
            <ul className="connector-group">
              {available.map(({ id, name, detail, Icon }) => (
                <li key={id}>
                  <div className="connector-row">
                    <ConnectorIcon id={id} Icon={Icon} />
                    <span className="connector-name" title={detail}>
                      {name}
                    </span>
                    <button
                      className="connector-connect"
                      disabled={busy}
                      aria-label={t("Connect {name}", { name })}
                      onClick={() => void connect(id)}
                    >
                      {busy && id === "health" ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        t("Connect")
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {!connected.length && !available.length && (
          <p className="connector-empty">{t("No results")}</p>
        )}
        <p className="connector-note">
          {t(
            "Other services are not connected in this app. Ask your assistant in chat; it can often use a service's website or command-line tool instead.",
          )}
        </p>
      </div>
    </Sheet>
  );
}
