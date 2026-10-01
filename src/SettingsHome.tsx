import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  ExternalLink,
  Info,
  KeyRound,
  MessageCircleHeart,
  Plug,
  ShieldCheck,
  SquareTerminal,
  Unplug,
} from "lucide-react";
import { t } from "../shared/i18n";
import type { Client } from "./api";
import { AuthPanel } from "./AuthPanel";
import { CheckInSettings } from "./CheckInSettings";
import { ConnectorsSheet } from "./ConnectorsSheet";
import { MuseMark } from "./components";
import { Sheet } from "./MusePages";
import "./settings-home.css";

type Section = "connectors" | "checkins" | "account" | "about";

// Settings as a status card and one list of sections, each in its own sheet.
// Until the app is connected, sign-in stays on the page itself.
export function SettingsHome({
  client,
  onConnection,
  onDraft,
}: {
  client: Client;
  onConnection: () => void;
  onDraft: (text: string) => void;
}) {
  const [section, setSection] = useState<Section>();
  const signedIn = client.signedIn();
  const close = () => setSection(undefined);
  return (
    <div className="page-content settings-page settings-home">
      {signedIn ? (
        <section className="settings-status">
          <div>
            <strong>Volcano Ark MA</strong>
            <span className="settings-status-badge">{t("Connected")}</span>
          </div>
          <p>
            {t(
              "Your assistant runs on Ark Managed Agents with your own key. Real calls may be billed.",
            )}
          </p>
          <button onClick={() => setSection("account")}>
            {t("Account and workspace")}
          </button>
        </section>
      ) : (
        <AuthPanel client={client} onChanged={onConnection} />
      )}
      <ul className="settings-list">
        <Row
          icon={<Plug size={21} />}
          label={t("Connectors")}
          onClick={() => setSection("connectors")}
        />
        {signedIn && (
          <Row
            icon={<MessageCircleHeart size={21} />}
            label={t("Check-ins")}
            onClick={() => setSection("checkins")}
          />
        )}
        {signedIn && (
          <Row
            icon={<KeyRound size={21} />}
            label={t("Account and workspace")}
            onClick={() => setSection("account")}
          />
        )}
        <li>
          <a className="settings-list-row" href="#/studio">
            <SquareTerminal size={21} aria-hidden="true" />
            <span>MA Studio</span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </li>
        <Row
          icon={<Info size={21} />}
          label={t("About")}
          onClick={() => setSection("about")}
        />
      </ul>
      {section === "connectors" && (
        <ConnectorsSheet
          onClose={close}
          onDraft={(text) => {
            close();
            onDraft(text);
          }}
        />
      )}
      {section === "checkins" && (
        <Sheet title={t("Check-ins")} onClose={close} grouped>
          <CheckInSettings client={client} bare />
        </Sheet>
      )}
      {section === "account" && (
        <Sheet title={t("Account and workspace")} onClose={close} grouped>
          <AuthPanel client={client} onChanged={onConnection} />
        </Sheet>
      )}
      {section === "about" && (
        <Sheet title={t("About")} onClose={close} grouped>
          <section className="privacy-grid">
            <div>
              <ShieldCheck size={22} />
              <h3>{t("Every step is visible")}</h3>
              <p>
                {t(
                  "Tools run directly by default and may send data to external services, change files, or incur charges. Upstream denials still apply. Execution records stay in the conversation.",
                )}
              </p>
            </div>
            <div>
              <Unplug size={22} />
              <h3>{t("A real connection")}</h3>
              <p>
                {t(
                  "If sign-in expires or a request fails, Muse reports the error instead of generating simulated replies.",
                )}
              </p>
            </div>
          </section>
          <div className="about-line">
            <span>
              <MuseMark />
              Open Muse <small>v0.2.0</small>
            </span>
            <a
              href="https://www.volcengine.com/product/ark"
              target="_blank"
              rel="noreferrer"
            >
              Volcano Ark
              <ExternalLink size={13} />
            </a>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button className="settings-list-row" onClick={onClick}>
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </li>
  );
}
