import { useEffect, useState } from "react";
import {
  Brain,
  ChevronRight,
  Globe,
  HeartPulse,
  LoaderCircle,
  MessagesSquare,
  Search,
  SquareTerminal,
} from "lucide-react";
import { t } from "../shared/i18n";
import { connectHealth, healthAccess } from "./health";
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
  name: t("Apple Health"),
  detail: t(
    "Your assistant asks in the chat before each read. Change what it can read in the Health app.",
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
const larkSignIn =
  "Help me sign in to Lark with lark-cli so you can work in my Lark account.";

export function ConnectorsSheet({
  onClose,
  onDraft,
}: {
  onClose: () => void;
  // Puts text in the main chat composer for the person to review and send.
  onDraft: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string>();
  const [access, setAccess] =
    useState<Awaited<ReturnType<typeof healthAccess>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
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
      onDraft(t(larkSignIn));
      return;
    }
    setBusy(true);
    try {
      await connectHealth();
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
  const connected = [
    ...included(),
    ...(access === "requested" ? healthItem : []),
  ].filter(matches);
  const available = [
    ...(access === "not_requested" ? healthItem : []),
    lark(),
  ].filter(matches);
  return (
    <Sheet title={t("Connectors")} onClose={onClose} grouped>
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
                    <span className="connector-icon" data-id={id}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="connector-name">{name}</span>
                    <ChevronRight
                      size={18}
                      className="connector-chevron"
                      aria-hidden="true"
                    />
                  </button>
                  {open === id && <p className="connector-detail">{detail}</p>}
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
                    <span className="connector-icon" data-id={id}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
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
