import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { KeyRound, LoaderCircle, LogOut } from "lucide-react";
import type { Client } from "./api";
import { WorkspacePanel } from "./WorkspacePanel";
import { BackgroundSettings } from "./BackgroundSettings";

interface Status {
  loggedIn: boolean;
  ready: boolean;
  project?: string;
  method?: "api_key";
  legacy?: "sso";
}
function ArkAuthPanel({
  client,
  onChanged,
}: {
  client: Client;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [apiKey, setAPIKey] = useState("");
  const [keyProject, setKeyProject] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  async function refresh() {
    setStatus(await client.auth<Status>("status"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [client]);
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="settings-card auth-card">
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <KeyRound size={21} />
        </div>
        <div>
          <h2>{t("Connect to Ark MA")}</h2>
          <p>
            {t(
              "Add an Ark API key and your personal assistant is set up automatically",
            )}
          </p>
        </div>
        <span className="small-badge">
          {status?.ready ? t("Connected") : t("Not connected")}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {status?.legacy === "sso" && (
        <p className="auth-consent-note" role="status">
          {t(
            "Volcano SSO sign-in is no longer supported. This device still holds the earlier SSO sign-in; it is not used. Remove it, then add an Ark API key. Data saved on this device is kept.",
          )}
        </p>
      )}
      {!status?.loggedIn && !status?.legacy && (
        <form
          className="auth-steps"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              try {
                await client.auth("api-key", {
                  apiKey: apiKey.trim(),
                  project: keyProject.trim(),
                  confirm: true,
                });
              } finally {
                setAPIKey("");
              }
              await refresh();
              onChanged();
            });
          }}
        >
          <label className="field">
            Ark API Key
            <input
              aria-label="Ark API Key"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={1024}
              value={apiKey}
              onChange={(event) => setAPIKey(event.target.value)}
              placeholder={t("Paste an existing Ark API Key")}
            />
          </label>
          <label className="field">
            {t("Project name (optional)")}
            <input
              autoComplete="off"
              autoCapitalize="none"
              maxLength={128}
              value={keyProject}
              onChange={(event) => setKeyProject(event.target.value)}
              placeholder={t("Leave blank to use the key's own project")}
            />
          </label>
          <p className="auth-consent-note">
            {t(
              "This device connects directly to Volcano Ark. Native apps store credentials in system-protected storage; the web app keeps them only for this browser session. The assistant and runtime are created automatically on first use; cloud calls may be billed.",
            )}
          </p>
          <button className="button primary" disabled={busy || !apiKey.trim()}>
            {t("Connect with API Key")}
          </button>
        </form>
      )}
      {status?.ready && (
        <div className="auth-connected">
          <p>
            {t("Connected with API Key")} ·{" "}
            {status.project ? (
              <>
                {t("Project")} <strong>{status.project}</strong>
              </>
            ) : (
              t("The key's own project")
            )}
          </p>
          <WorkspacePanel client={client} />
        </div>
      )}
      {(status?.loggedIn || status?.legacy || client.signedIn()) && (
        <div className="logout-row">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.auth("logout", {});
                await refresh();
                onChanged();
              })
            }
          >
            <LogOut size={15} />
            {status?.legacy
              ? t("Remove the earlier SSO sign-in")
              : t("Sign out of this login")}
          </button>
          <small>
            {t(
              "Removing the login deletes this device's saved credentials but does not revoke the cloud API Key. You can revoke it in the Ark console.",
            )}
          </small>
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          <LoaderCircle className="spin" size={15} />{" "}
          {t("Working, please don't submit again…")}
        </p>
      )}
    </section>
  );
}

export function AuthPanel(props: Parameters<typeof ArkAuthPanel>[0]) {
  return (
    <>
      <ArkAuthPanel {...props} />
      <BackgroundSettings client={props.client} />
    </>
  );
}
