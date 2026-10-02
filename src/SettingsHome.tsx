import { useState, type ReactNode } from "react";
import {
  ExternalLink,
  Info,
  Check,
  KeyRound,
  Languages,
  MessageCircleHeart,
  Plug,
  ShieldCheck,
  SquareTerminal,
  Unplug,
} from "lucide-react";
import {
  deviceLanguage,
  languageChoice,
  setLanguageChoice,
  t,
  type LanguageChoice,
} from "../shared/i18n";
import type { Client } from "./api";
import { AuthPanel } from "./AuthPanel";
import { CheckInSettings } from "./CheckInSettings";
import { ConnectorsSheet } from "./ConnectorsSheet";
import { MuseMark } from "./components";
import { Sheet } from "./MusePages";
import "./settings-home.css";

type Section =
  "connectors" | "checkins" | "language" | "account" | "about" | "reset";

// Each language is named in itself, as system language pickers do.
const languageNames = { en: "English", "zh-CN": "简体中文" } as const;

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
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  async function reset() {
    if (resetting) return;
    setResetting(true);
    setResetError("");
    try {
      await client.resetDevice();
      location.hash = "/";
      location.reload();
    } catch (reason) {
      setResetError((reason as Error).message);
      setResetting(false);
    }
  }
  const signedIn = client.signedIn();
  const close = () => setSection(undefined);
  return (
    <div className="settings-home">
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
          icon={<Plug size={22} strokeWidth={2} />}
          label={t("Connectors")}
          onClick={() => setSection("connectors")}
        />
        {signedIn && (
          <Row
            icon={<MessageCircleHeart size={22} strokeWidth={2} />}
            label={t("Check-ins")}
            onClick={() => setSection("checkins")}
          />
        )}
        <Row
          icon={<Languages size={22} strokeWidth={2} />}
          label={t("Language")}
          value={
            languageChoice() === "system"
              ? t("Follow system")
              : languageNames[languageChoice() as keyof typeof languageNames]
          }
          onClick={() => setSection("language")}
        />
        {signedIn && (
          <Row
            icon={<KeyRound size={22} strokeWidth={2} />}
            label={t("Account and workspace")}
            onClick={() => setSection("account")}
          />
        )}
        <li>
          <a className="settings-list-row" href="#/studio">
            <SquareTerminal size={22} strokeWidth={2} aria-hidden="true" />
            <span>MA Studio</span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </li>
        <Row
          icon={<Info size={22} strokeWidth={2} />}
          label={t("About")}
          onClick={() => setSection("about")}
        />
      </ul>
      <ul className="settings-list">
        <li>
          <button
            className="settings-list-row settings-destructive"
            disabled={resetting}
            onClick={() => setSection("reset")}
          >
            <span>{resetting ? t("Resetting…") : t("Reset this device")}</span>
          </button>
        </li>
      </ul>
      {section === "language" && (
        <Sheet title={t("Language")} onClose={close} grouped>
          <ul className="settings-list" role="radiogroup">
            {(["system", "en", "zh-CN"] as LanguageChoice[]).map((choice) => (
              <li key={choice}>
                <button
                  className="settings-list-row"
                  role="radio"
                  aria-checked={languageChoice() === choice}
                  onClick={() => {
                    if (choice === languageChoice()) return close();
                    setLanguageChoice(choice);
                    location.reload();
                  }}
                >
                  <span>
                    {choice === "system"
                      ? `${t("Follow system")} (${languageNames[deviceLanguage()]})`
                      : languageNames[choice]}
                  </span>
                  {languageChoice() === choice && (
                    <Check size={18} className="settings-check" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="settings-footnote">
            {t("The app restarts in the language you choose.")}
          </p>
        </Sheet>
      )}
      {section === "reset" && (
        <Sheet
          title={t("Reset this device")}
          onClose={() => !resetting && close()}
          grouped
        >
          <p className="settings-reset-copy">
            {t(
              "Reset this device? This removes the saved Ark API key and sign-ins from this device and deletes all local data, including the conversation list, saved replies, Feed, and settings. Open Muse restarts as if newly installed. Your agents, conversations, and memory in the cloud are not deleted.",
            )}
          </p>
          {resetError && (
            <p className="settings-footnote" role="alert">
              {resetError}
            </p>
          )}
          <div className="settings-reset-actions">
            <button
              className="settings-reset-confirm"
              disabled={resetting}
              onClick={() => void reset()}
            >
              {resetting ? t("Resetting…") : t("Reset")}
            </button>
            <button disabled={resetting} onClick={close}>
              {t("Cancel")}
            </button>
          </div>
        </Sheet>
      )}
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

// A list disclosure chevron at the system size; it grows with the text.
export function RowChevron() {
  return (
    <svg className="row-chevron" viewBox="0 0 9 16" aria-hidden="true">
      <path
        d="M1.5 1.5 8 8l-6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button className="settings-list-row" onClick={onClick}>
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
        {value && <span className="settings-row-value">{value}</span>}
        <RowChevron />
      </button>
    </li>
  );
}
