import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  File,
  Hand,
  LayoutGrid,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  TabletSmartphone,
  Wallet,
  createLucideIcon,
} from "lucide-react";
import { t, type LanguageChoice } from "../../shared/i18n";
import {
  setWebAccessDefault,
  webAccessDefault,
  type WebAccess,
} from "../../shared/approval-policy";
import type { Client } from "../../src/api";
import { backgroundClient } from "../../src/background-client";
import { AuthPanel } from "../../src/AuthPanel";
import { Modal } from "./Chrome";
import { PresenceSettings } from "./PresenceSettings";
import { CheckInSwitch } from "./CheckInSwitch";
import { ComputerSettings } from "./ComputerSettings";
import { DictationSettings } from "./DictationSettings";
import { HelpSettings } from "./HelpSettings";
import { DataControls } from "./DataControls";
import { DevicesSettings } from "./DevicesSettings";
import { SecureStorage } from "./SecureStorage";
import { FileSystemSettings } from "./FileSystemSettings";
import { ConnectorsSettings } from "./ConnectorsSettings";
import { LegalSettings } from "./LegalSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { shortcutAvailable } from "./shortcut";
import {
  appearances,
  saveAppearance,
  saveTheme,
  storedAppearance,
  storedTheme,
  themeColors,
  type Appearance,
  type ThemeColor,
} from "./appearance";
import {
  connectionError,
  connectionReady,
  restoreInBackground,
} from "./startup";
import {
  activeLanguage,
  chooseLanguage,
  appVersion,
  clientWithConfirmedSignOut,
  connectionSummary,
  settingsPath,
  settingsRouteSection,
  settingsSection,
  settingsSections,
  type ConnectionStatus,
  type SettingsSectionId,
} from "./settings";
import "./settings.css";

// A shield with a keyhole marks the secrets the assistant may use.
const ShieldKeyhole = createLucideIcon("shield-keyhole", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "shield",
    },
  ],
  ["circle", { cx: "12", cy: "11", r: "2", fill: "currentColor", key: "hole" }],
  ["path", { d: "M12 13v3", key: "slot" }],
]);

// A shield around a person, for privacy.
const ShieldPerson = createLucideIcon("shield-person", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "shield",
    },
  ],
  ["circle", { cx: "12", cy: "10", r: "2.5", key: "head" }],
  ["path", { d: "M7.8 17.2a5 5 0 0 1 8.4 0", key: "shoulders" }],
]);

const icons: Record<SettingsSectionId, typeof Settings> = {
  general: Settings,
  connectors: LayoutGrid,
  "computer-use": Monitor,
  "file-system": File,
  dictation: Mic,
  wallet: Wallet,
  "secure-storage": ShieldKeyhole,
  permissions: Hand,
  "message-channels": MessageCircle,
  devices: TabletSmartphone,
  "data-controls": Lock,
  help: CircleHelp,
  legal: ShieldCheck,
};

const appearanceIcons: Record<Appearance, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function Row({
  title,
  detail,
  value,
}: {
  title: string;
  detail?: string;
  value?: string;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      {value && <span>{value}</span>}
    </div>
  );
}

export function SettingsWindow({ client }: { client: Client }) {
  const [section, setSection] = useState<SettingsSectionId>(() =>
    settingsRouteSection(location.hash),
  );
  const [signOut, setSignOut] = useState<{ resolve?: (ok: boolean) => void }>();
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [manage, setManage] = useState(false);
  // General > Language opens its own page within the section.
  const [languagePage, setLanguagePage] = useState(false);
  const [webAccess, setWebAccess] = useState(webAccessDefault);
  useEffect(() => setLanguagePage(false), [section]);
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance);
  const [theme, setTheme] = useState<ThemeColor>(storedTheme);
  // The workspace and Quick Chat can change these too; the picker follows them.
  useEffect(() => {
    const follow = () => {
      setAppearance(storedAppearance());
      setTheme(storedTheme());
    };
    window.addEventListener("muse-appearance-changed", follow);
    window.addEventListener("storage", follow);
    return () => {
      window.removeEventListener("muse-appearance-changed", follow);
      window.removeEventListener("storage", follow);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const [language, setLanguage] = useState(activeLanguage);
  const version = useMemo(appVersion, []);
  const active = settingsSection(section);
  const summary = connectionSummary(connection);
  const readStatus = useCallback(async () => {
    try {
      const status = await client.auth<ConnectionStatus>("status");
      if (alive.current) setConnection(status);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    }
  }, [client]);
  // The shared panel's own sign-out button must stop at the same confirmation
  // as the sidebar, so it runs against a client that asks this window first.
  const guarded = useMemo(
    () =>
      clientWithConfirmedSignOut(
        client,
        () =>
          new Promise<boolean>((resolve) => {
            if (!alive.current) return resolve(false);
            setSignOut({ resolve });
          }),
      ),
    [client],
  );
  useEffect(() => {
    alive.current = true;
    const route = () => setSection(settingsRouteSection(location.hash));
    window.addEventListener("hashchange", route);
    // The window renders before the Keychain login is restored, so it refreshes
    // when the restore settles and reports a denied read instead of hanging.
    const ready = (event: Event) => {
      if (!alive.current) return;
      setError(connectionError(event));
      void readStatus();
    };
    window.addEventListener(connectionReady, ready);
    window.addEventListener("muse-credentials-changed", ready);
    // A sign-in can finish after this window last asked, for example once a
    // Keychain prompt is allowed, and the window is kept alive between uses.
    // Read the connection again whenever it comes back into view.
    const reread = () => {
      if (!window.document.hidden) void readStatus();
    };
    window.addEventListener("focus", reread);
    window.document.addEventListener("visibilitychange", reread);
    void readStatus();
    return () => {
      alive.current = false;
      window.removeEventListener("hashchange", route);
      window.removeEventListener(connectionReady, ready);
      window.removeEventListener("muse-credentials-changed", ready);
      window.removeEventListener("focus", reread);
      window.document.removeEventListener("visibilitychange", reread);
    };
  }, [readStatus]);
  // While it is open and not yet connected, check again every few seconds so
  // a sign-in completed elsewhere shows up without reopening the window.
  useEffect(() => {
    if (connection?.loggedIn && connection.ready) return;
    const timer = setInterval(() => {
      if (!window.document.hidden) void readStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [connection, readStatus]);
  // Each section opens at its top, wherever the previous one was scrolled.
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [section]);
  useEffect(() => {
    if (location.hash !== settingsPath(section))
      history.replaceState(null, "", settingsPath(section));
  }, [section]);
  function resolveSignOut(confirmed: boolean) {
    signOut?.resolve?.(confirmed);
    setSignOut(undefined);
  }

  return (
    <div className="settings-window">
      <nav className="settings-sidebar" aria-label={t("Settings sections")}>
        <div className="settings-sidebar-items">
          {settingsSections.map(({ id, label }) => {
            const Icon = icons[id];
            return (
              <button
                key={id}
                aria-current={id === section ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                <Icon size={15} strokeWidth={1.75} />
                {t(label)}
              </button>
            );
          })}
        </div>
        <button className="settings-sign-out" onClick={() => setSignOut({})}>
          <LogOut size={15} strokeWidth={1.75} />
          {t("Sign out")}
        </button>
      </nav>
      <main className="settings-main" ref={main}>
        {active.id === "general" && languagePage ? (
          <header className="settings-child-header">
            <button
              className="settings-back"
              aria-label={t("Go back")}
              onClick={() => setLanguagePage(false)}
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
            <h1>{t("Language preference")}</h1>
          </header>
        ) : (
          <h1>
            {active.id === "secure-storage"
              ? t("Secure credential vault")
              : t(active.label)}
          </h1>
        )}
        {error && (
          <p className="settings-error" role="alert">
            <span>{error}</span>
            <button onClick={() => void restoreInBackground(client)}>
              {t("Try again")}
            </button>
          </p>
        )}
        {active.id === "general" && languagePage && (
          <>
            <p className="settings-intro">
              {t(
                "See buttons, titles and other text in Open Muse in your preferred language.",
              )}
            </p>
            <div
              className="settings-group"
              role="radiogroup"
              aria-label={t("Language preference")}
            >
              {(
                [
                  [
                    "system",
                    `${t("Follow system")} (${language.device === "zh-CN" ? "简体中文" : "English"})`,
                  ],
                  ["en", "English"],
                  ["zh-CN", "简体中文"],
                ] as [LanguageChoice, string][]
              ).map(([choice, label]) => (
                <label className="settings-row settings-radio-row" key={choice}>
                  <span>{label}</span>
                  <input
                    type="radio"
                    name="open-muse-language"
                    value={choice}
                    className="settings-radio"
                    checked={language.choice === choice}
                    onChange={() => {
                      chooseLanguage(choice);
                      setLanguage(activeLanguage());
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="settings-footnote">
              {t("Menus and dialogs switch the next time Open Muse opens.")}
            </p>
          </>
        )}
        {active.id === "general" && !languagePage && (
          <>
            <h2>{t("Connection")}</h2>
            <div className="settings-group">
              <Row title={t("Status")} value={t(summary.state)} />
              {Boolean(summary.method) && (
                <Row title={t("Sign-in method")} value={summary.method} />
              )}
              {Boolean(summary.project) && (
                <Row title={t("Project")} value={summary.project} />
              )}
              <button
                className="settings-disclosure"
                aria-expanded={manage}
                onClick={() => setManage((value) => !value)}
              >
                <strong>
                  {summary.state === "Connected"
                    ? t("Manage connection")
                    : t("Connect to Ark MA")}
                </strong>
                <ChevronDown size={17} className={manage ? "open" : ""} />
              </button>
            </div>
            {manage && (
              <div className="settings-group settings-auth">
                <AuthPanel
                  client={guarded}
                  onChanged={() => void readStatus()}
                />
              </div>
            )}
            <div className="settings-group">
              <button
                className="settings-row settings-nav-row"
                onClick={() => setLanguagePage(true)}
              >
                <span>{t("Language")}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
            <h2>{t("Appearance")}</h2>
            <div className="settings-group">
              <div className="settings-row">
                <div>
                  <strong>{t("Mode")}</strong>
                </div>
                <div
                  className="settings-segments"
                  role="radiogroup"
                  aria-label={t("Appearance")}
                >
                  {appearances.map(({ id, label }) => {
                    const Icon = appearanceIcons[id];
                    return (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={appearance === id}
                        aria-label={t(label)}
                        title={t(label)}
                        onClick={() => {
                          saveAppearance(id);
                          setAppearance(id);
                        }}
                      >
                        <Icon size={16} strokeWidth={1.8} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="settings-row settings-theme-row">
                <div>
                  <strong>{t("Theme color")}</strong>
                </div>
                <div
                  className="settings-swatches"
                  role="radiogroup"
                  aria-label={t("Theme color")}
                >
                  {themeColors.map(({ id, label }) => (
                    <button
                      key={id}
                      role="radio"
                      data-swatch={id}
                      aria-checked={theme === id}
                      aria-label={t(label)}
                      title={t(label)}
                      onClick={() => {
                        saveTheme(id);
                        setTheme(id);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <h2>{t("App behavior")}</h2>
            <PresenceSettings />
            {shortcutAvailable() && <h2>{t("Shortcuts")}</h2>}
            <ShortcutSettings />
            {client.signedIn() && <h2>{t("Check-ins")}</h2>}
            <CheckInSwitch client={client} />
            <h2>{t("About")}</h2>
            <div className="settings-group">
              <Row
                title={t("Version")}
                value={version || t("Unknown outside the Mac app")}
              />
              <Row
                title={t("Updates")}
                detail={t(
                  "Automatic update checks are not built yet. Install a newer build yourself.",
                )}
              />
            </div>
          </>
        )}
        {active.id === "computer-use" && <ComputerSettings />}
        {active.id === "connectors" && (
          <ConnectorsSettings
            onSection={(id) => setSection(settingsSection(id).id)}
          />
        )}
        {active.id === "file-system" && <FileSystemSettings />}
        {active.id === "dictation" && <DictationSettings />}
        {active.id === "help" && <HelpSettings signedIn={client.signedIn()} />}
        {active.id === "devices" && <DevicesSettings />}
        {active.id === "legal" && <LegalSettings />}
        {active.id === "secure-storage" && (
          <>
            <SecureStorage client={client} />
            <h2>{t("On this Mac")}</h2>
            <div className="settings-group">
              <Row
                title={t("Ark credentials")}
                detail={t(
                  "Stored in your login Keychain for this app. macOS may ask you to authorize access after a new build is installed.",
                )}
              />
              <Row
                title={t("Other devices")}
                detail={t(
                  "Credentials never sync. Signing in here does not sign in anywhere else.",
                )}
              />
              <Row
                title={t("Agent credential vaults")}
                detail={t(
                  "Secrets for your assistant live in an MA vault in your Ark project, separate from this Mac's Keychain.",
                )}
              />
            </div>
            <p className="settings-footnote">
              {t(
                "Credentials for this Mac live in the macOS Keychain and are read through the native bridge. They are never written into the page, a file, or a server.",
              )}
            </p>
          </>
        )}
        {active.id === "permissions" && (
          <>
            <section>
              <h2>{t("Web access defaults")}</h2>
              <div className="settings-group" role="radiogroup">
                {(
                  [
                    [
                      "some",
                      t("Ask for some actions"),
                      t(
                        "Web searches and page reads your agent asks about are approved for you",
                      ),
                    ],
                    [
                      "always",
                      t("Always ask"),
                      t(
                        "Every web request your agent asks about waits for you",
                      ),
                    ],
                  ] as [WebAccess, string, string][]
                ).map(([value, title, detail]) => (
                  <label
                    className="settings-row settings-radio-row"
                    key={value}
                  >
                    <div>
                      <strong>{title}</strong>
                      <p>{detail}</p>
                    </div>
                    <input
                      type="radio"
                      name="open-muse-web-access"
                      value={value}
                      className="settings-radio"
                      checked={webAccess === value}
                      onChange={() => {
                        setWebAccessDefault(value);
                        setWebAccess(webAccessDefault());
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="settings-footnote">
                {t(
                  "This applies to requests your agent sends for approval; tools it is allowed to run directly are not asked about. Computer control has its own choice under Computer use.",
                )}
              </p>
            </section>
            <h2>{t("How requests are handled")}</h2>
            <div className="settings-group">
              <Row
                title={t("Built-in tools")}
                detail={t(
                  "The workspace this app provisions sets its agent toolset to always-allow, so MA runs those tools directly without asking. Cloud calls, external writes and billing can follow from one message.",
                )}
              />
              <Row
                title={t("When MA does ask")}
                detail={t(
                  "MA still sends a permission request for anything its own policy evaluates as ask, and the conversation shows it.",
                )}
              />
              <Row
                title={t("Automatically approved")}
                detail={
                  webAccess === "some"
                    ? t(
                        "Pending web_search and web_fetch requests, matched by exact protocol name, and computer control on this Mac only if you choose Always allow in Computer use. Calendar and Location always ask.",
                      )
                    : t(
                        "Only computer control on this Mac, if you choose Always allow in Computer use. Calendar and Location always ask.",
                      )
                }
              />
              <Row
                title={t("Everything else waits")}
                detail={t(
                  "Every other pending permission request stays in the conversation until you answer it.",
                )}
              />
              <Row
                title={t("Write requests")}
                detail={t(
                  "A write is never retried automatically. If a result is unclear, the app reads history instead of repeating it.",
                )}
              />
            </div>
          </>
        )}
        {active.id === "data-controls" && (
          <>
            <div className="settings-group">
              <div className="settings-row settings-privacy-row">
                <ShieldPerson size={22} strokeWidth={1.7} aria-hidden="true" />
                <div>
                  <strong>{t("We care about your privacy")}</strong>
                  <p>
                    {backgroundClient.configured()
                      ? t(
                          "Chats go straight to your Ark project. No analytics or crash reports leave this Mac.",
                        )
                      : t(
                          "Open Muse has no server of its own. Nothing is collected, and no analytics or crash reports leave this Mac.",
                        )}
                  </p>
                </div>
              </div>
            </div>
            <DataControls client={client} />
            <h2>{t("Where your data lives")}</h2>
            <div className="settings-group">
              <Row
                title={t("On this Mac")}
                detail={t(
                  "Conversation index, goals, ideas, feed preferences and saved Library replies live in a local database scoped to the connected account and project.",
                )}
              />
              <Row
                title={t("In your Ark project")}
                detail={t(
                  "Sessions, events, memory documents and agent configuration stay in the cloud project you connected, under its own retention rules.",
                )}
              />
              {backgroundClient.configured() && (
                <Row
                  title={t("With the Open Muse service")}
                  detail={t(
                    "Your Muse account sign-in, your Ark key encrypted for that account, the devices you use, and the Upcoming items you let run while you are away.",
                  )}
                />
              )}
              <Row
                title={t("Signing out")}
                detail={t(
                  "Removes this Mac's credentials. Local records are preserved and are unreadable without the same connection.",
                )}
              />
            </div>
          </>
        )}
        {!active.connected && (
          <>
            <p className="settings-lead">{t(active.unavailable!)}</p>
            <div className="settings-group settings-unavailable">
              <Row
                title={t("Not connected")}
                detail={t(
                  "Open Muse doesn't offer this yet. Nothing here is simulated.",
                )}
              />
            </div>
          </>
        )}
      </main>
      {signOut && (
        <Modal
          title={t("Sign out of this Mac?")}
          onClose={() => !busy && resolveSignOut(false)}
        >
          <p>
            {t(
              "Removing the login deletes this device's saved credentials but does not revoke the cloud API Key. You can revoke it in the Ark console.",
            )}
          </p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => resolveSignOut(false)}
            >
              {t("Cancel")}
            </button>
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                // A request from the shared panel is waiting on this answer;
                // the sidebar entry has no waiter and signs out here.
                const waiter = signOut.resolve;
                if (waiter) {
                  resolveSignOut(true);
                  return;
                }
                setBusy(true);
                setError("");
                void client
                  .auth("logout", {})
                  .then(() => {
                    if (!alive.current) return;
                    resolveSignOut(false);
                    setSection("general");
                    void readStatus();
                  })
                  .catch((failure: Error) => {
                    if (alive.current) setError(failure.message);
                  })
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              {t("Sign out")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
