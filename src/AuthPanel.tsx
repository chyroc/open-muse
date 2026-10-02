import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { KeyRound, LoaderCircle, LogOut } from "lucide-react";
import type { Client } from "./api";
import { WorkspacePanel } from "./WorkspacePanel";
import { BackgroundSettings } from "./BackgroundSettings";
import { AccountPanel } from "./AccountPanel";
import type { BackgroundClient } from "./background-client";

interface Status {
  loggedIn: boolean;
  ready: boolean;
  project?: string;
  method?: "api_key";
  legacy?: "api_key";
  legacyKey?: boolean;
  // Present in builds with an Open Muse account service.
  account?: { signedIn: boolean };
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
  const [replacing, setReplacing] = useState(false);
  const [removeConsent, setRemoveConsent] = useState(false);
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
  const account = status?.account;
  const signedOut = Boolean(account && !account.signedIn);
  const showForm =
    !signedOut &&
    (account ? !status?.ready || replacing : !status?.loggedIn);
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
      {signedOut && (
        <p className="auth-consent-note" role="status">
          {t("Sign in to your Open Muse account above to add your Ark API key.")}
        </p>
      )}
      {account && status?.legacyKey && (
        <div className="auth-steps">
          <p className="auth-consent-note" role="status">
            {t(
              "This device has an Ark API key saved by an earlier version of Open Muse. It is not used until you save it to your Open Muse account. Conversations and data from that earlier setup stay on this device and are not moved into your account.",
            )}
          </p>
          <div className="background-actions">
            <button
              className="button primary"
              disabled={busy || signedOut}
              onClick={() =>
                void run(async () => {
                  await client.auth("import-legacy", { confirm: true });
                  await refresh();
                  onChanged();
                })
              }
            >
              {t("Save this key to my account")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.auth("remove-legacy", { confirm: true });
                  await refresh();
                })
              }
            >
              {t("Remove it from this device")}
            </button>
          </div>
        </div>
      )}
      {showForm && (
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
              setReplacing(false);
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
            {account
              ? t(
                  "Ark checks the key once, then it is stored encrypted in your Open Muse account so your signed-in devices can use it. The key is a model-service credential, not your identity. Replacing it starts a separate workspace and stops background work tied to the old key. Cloud calls may be billed.",
                )
              : t(
                  "This device connects directly to Volcano Ark. Native apps store credentials in system-protected storage; the web app keeps them only for this browser session. The assistant and runtime are created automatically on first use; cloud calls may be billed.",
                )}
          </p>
          <div className="background-actions">
            <button
              className="button primary"
              disabled={busy || !apiKey.trim()}
            >
              {account
                ? t("Save API key to my account")
                : t("Connect with API Key")}
            </button>
            {replacing && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setReplacing(false)}
              >
                {t("Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
      {status?.ready && (
        <div className="auth-connected">
          <p>
            {account
              ? t("Saved in your Open Muse account")
              : t("Connected with API Key")}{" "}
            ·{" "}
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
      {account && status?.ready ? (
        <div className="logout-row">
          {!replacing && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setReplacing(true)}
            >
              {t("Replace API key")}
            </button>
          )}
          <label className="background-consent background-remove-consent">
            <input
              type="checkbox"
              checked={removeConsent}
              disabled={busy}
              onChange={(event) => setRemoveConsent(event.target.checked)}
            />
            {t(
              "Remove the key from my Open Muse account on all devices and stop background work that uses it. The key stays valid at Ark until you revoke it there.",
            )}
          </label>
          <button
            className="button secondary"
            disabled={busy || !removeConsent}
            onClick={() =>
              void run(async () => {
                await client.auth("logout", { confirm: true });
                setRemoveConsent(false);
                await refresh();
                onChanged();
              })
            }
          >
            <LogOut size={15} />
            {t("Remove API key from my account")}
          </button>
        </div>
      ) : (
        !account &&
        (status?.loggedIn || client.signedIn()) && (
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
              {t("Sign out of this login")}
            </button>
            <small>
              {t(
                "Removing the login deletes this device's saved credentials but does not revoke the cloud API Key. You can revoke it in the Ark console.",
              )}
            </small>
          </div>
        )
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

export function AuthPanel({
  client,
  onChanged,
  service,
}: {
  client: Client;
  onChanged: () => void;
  service?: BackgroundClient;
}) {
  // Remount the account-dependent cards whenever the signed-in account changes.
  const [account, setAccount] = useState(0);
  return (
    <>
      <AccountPanel
        service={service}
        client={client}
        onChanged={() => {
          setAccount((value) => value + 1);
          onChanged();
        }}
      />
      <ArkAuthPanel
        key={`ark-${account}`}
        client={client}
        onChanged={onChanged}
      />
      <BackgroundSettings
        key={`background-${account}`}
        service={service}
        client={client}
      />
    </>
  );
}
