import { useState } from "react";
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
      {notice && <p className="settings-lead settings-after">{notice}</p>}
      <p className="settings-lead settings-after">
        {t(
          "Other services are not connected in this app. Ask your assistant in chat; it can often use a service's website or command-line tool instead.",
        )}
      </p>
    </>
  );
}
