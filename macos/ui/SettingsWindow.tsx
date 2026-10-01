import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  ChevronDown,
  Fingerprint,
  FileText,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  LogOut,
  MessageSquare,
  MonitorSmartphone,
  Monitor,
  Moon,
  Mouse,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Wallet,
} from "lucide-react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { AuthPanel } from "../../src/AuthPanel";
import { Modal } from "./Chrome";
import { PresenceSettings } from "./PresenceSettings";
import { CheckInSwitch } from "./CheckInSwitch";
import { ComputerSettings } from "./ComputerSettings";
import { DictationSettings } from "./DictationSettings";
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

const icons: Record<SettingsSectionId, typeof KeyRound> = {
  general: SlidersHorizontal,
  connectors: Blocks,
  "computer-use": Mouse,
  "file-system": FileText,
  dictation: MessageSquare,
  wallet: Wallet,
  "secure-storage": KeyRound,
  permissions: ShieldCheck,
  "message-channels": Globe,
  devices: MonitorSmartphone,
  "data-controls": HardDrive,
  help: Info,
  legal: Scale,
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
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance);
  const [theme, setTheme] = useState<ThemeColor>(storedTheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const language = useMemo(activeLanguage, []);
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
    void readStatus();
    return () => {
      alive.current = false;
      window.removeEventListener("hashchange", route);
      window.removeEventListener(connectionReady, ready);
      window.removeEventListener("muse-credentials-changed", ready);
    };
  }, [readStatus]);
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
                <Icon size={17} strokeWidth={1.8} />
                {t(label)}
              </button>
            );
          })}
        </div>
        <button className="settings-sign-out" onClick={() => setSignOut({})}>
          <LogOut size={17} strokeWidth={1.8} />
          {t("Sign out")}
        </button>
      </nav>
      <main className="settings-main">
        <h1>{t(active.label)}</h1>
        {error && (
          <p className="settings-error" role="alert">
            <span>{error}</span>
            <button onClick={() => void restoreInBackground(client)}>
              {t("Try again")}
            </button>
          </p>
        )}
        {active.id === "general" && (
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
            <h2>{t("Language")}</h2>
            <div className="settings-group">
              <Row
                title={t("Interface language")}
                detail={t(
                  "Muse follows your system language list and keeps no separate override, so changing it in System Settings changes the app.",
                )}
                value={language.language === "zh-CN" ? "简体中文" : "English"}
              />
              <Row
                title={t("Date and number format")}
                value={language.locale}
              />
              {Boolean(language.preferred.length) && (
                <Row
                  title={t("System preference list")}
                  value={language.preferred.slice(0, 4).join(", ")}
                />
              )}
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
        {active.id === "dictation" && <DictationSettings />}
        {active.id === "secure-storage" && (
          <>
            <p className="settings-lead">
              {t(
                "Credentials for this Mac live in the macOS Keychain and are read through the native bridge. They are never written into the page, a file, or a server.",
              )}
            </p>
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
                  "MA vault storage for your agent's own credentials is not connected in this Mac build.",
                )}
              />
            </div>
          </>
        )}
        {active.id === "permissions" && (
          <>
            <p className="settings-lead">
              {t(
                "Your MA agent and environment decide what may run. This window reports those rules and the client's own handling; it changes neither.",
              )}
            </p>
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
                detail={t(
                  "Only pending web_search and web_fetch requests, matched by exact protocol name. There is no setting that widens this.",
                )}
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
            <p className="settings-lead">
              {t(
                "Open Muse has no server of its own. Nothing is collected, and no analytics or crash reports leave this Mac.",
              )}
            </p>
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
                  "This section is listed because the desktop app it follows has it. Nothing here is simulated.",
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
