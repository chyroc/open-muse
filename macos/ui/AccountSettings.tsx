import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { AuthPanel } from "../../src/AuthPanel";
import { backgroundClient } from "../../src/background-client";
import { shownAccountId, useAccount } from "../../src/useAccount";
import { WorkspacePanel } from "../../src/WorkspacePanel";

// The account section of Settings > General, in the same grouped rows as the
// other settings: who is signed in, the Ark API key the account keeps,
// exporting its data, and deleting it. Signed out, it is the sign-in form.
// Signing out sits with deleting the account, after a confirmation; resetting
// this Mac is in Data controls. The workspace shows only when it needs
// attention.
export function AccountSettings({
  client,
  onChanged,
  onSignOut,
}: {
  client: Client;
  onChanged: () => void;
  // Asks to sign this Mac out; the caller confirms first.
  onSignOut: () => void;
}) {
  if (!backgroundClient.accountOwner())
    return backgroundClient.accountConfigured() &&
      !backgroundClient.retiredConnection() &&
      !backgroundClient.accountSessionUnconfirmed() ? (
      <SignedOut client={client} onChanged={onChanged} />
    ) : (
      // A build without the account service, an old device token, or an
      // unconfirmed session renewal: the shared panel explains each case.
      <>
        <h2>{t("Open Muse account")}</h2>
        <div className="settings-group settings-auth">
          <AuthPanel client={client} onChanged={onChanged} />
        </div>
      </>
    );
  return (
    <SignedIn client={client} onChanged={onChanged} onSignOut={onSignOut} />
  );
}

// Signed out, the section is only the sign-in form: the Ark API key is added
// after signing in, to the account.
function SignedOut({
  client,
  onChanged,
}: {
  client: Client;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  async function submit() {
    if (lock.current || (register && !consent)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const address = email.trim();
    try {
      if (register) {
        await backgroundClient.signUpAccount(address, password);
        setRegister(false);
        setConsent(false);
      }
      // A new account signs in through the ordinary sign-in; the signup
      // response itself is never adopted as a session.
      try {
        await backgroundClient.signInAccount(address, password);
      } catch (failure) {
        if (!register) throw failure;
        setNotice(
          t(
            "Registration submitted. Check your email if verification is required, then sign in. This does not confirm that a new account was created.",
          ),
        );
        return;
      }
      try {
        await client.accountChanged();
      } finally {
        onChanged();
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPassword("");
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <h2>{t("Open Muse account")}</h2>
      <form
        className="settings-auth"
        aria-label={t("Open Muse account login")}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="settings-group">
          <label className="settings-row settings-field-row">
            <span>{t("Account email")}</span>
            <input
              type="email"
              value={email}
              required
              maxLength={254}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="settings-row settings-field-row">
            <span>{t("Account password")}</span>
            <input
              type="password"
              value={password}
              required
              minLength={8}
              maxLength={1024}
              autoComplete={register ? "new-password" : "current-password"}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {register && (
            <label className="settings-row settings-consent-row">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                {t(
                  "Create an Open Muse account with this email. The Auth provider will receive the email and password.",
                )}
              </span>
            </label>
          )}
        </div>
        <div className="settings-signin-actions">
          <button
            className="settings-primary-button"
            disabled={
              busy ||
              !email.trim() ||
              password.length < 8 ||
              (register && !consent)
            }
          >
            {register
              ? t("Create Open Muse account")
              : t("Sign in to Open Muse")}
          </button>
          <button
            type="button"
            className="settings-inline-button"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setPassword("");
              setConsent(false);
              setError("");
            }}
          >
            {register
              ? t("Use an existing account")
              : t("Create an account instead")}
          </button>
        </div>
      </form>
      <p className="settings-footnote settings-signin-note">
        {t(
          "Your identity on every device. Your Ark API key, workspace, and history belong to it.",
        )}
      </p>
      {(notice || busy) && (
        <p className="settings-lead settings-after" role="status">
          {notice || t("Working, please don't submit again…")}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function SignedIn({
  client,
  onChanged,
  onSignOut,
}: {
  client: Client;
  onChanged: () => void;
  onSignOut: () => void;
}) {
  const {
    status,
    owner,
    email,
    busy,
    error,
    notice,
    saveKey,
    removeKey,
    deleteAccount,
    exportData,
  } = useAccount({ client, onChanged });
  const [replacing, setReplacing] = useState(false);
  const [apiKey, setAPIKey] = useState("");
  const label = email ?? t("Open Muse account");
  return (
    <>
      <h2>{t("Open Muse account")}</h2>
      <div className="settings-group">
        <div className="settings-row settings-account-row">
          <span className="settings-account-avatar" aria-hidden="true">
            {label.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{label}</strong>
            <p>
              {t(
                "Your identity on every device. Your Ark API key, workspace, and history belong to it.",
              )}
            </p>
          </div>
        </div>
      </div>
      <h2>Ark API Key</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>
              {status?.ready
                ? t("Saved in your Open Muse account")
                : t("Not connected")}
            </strong>
            {status?.project && (
              <p>
                {t("Project")} {status.project}
              </p>
            )}
          </div>
          {status?.ready && <span>{t("Connected")}</span>}
        </div>
        {status && (!status.ready || replacing) ? (
          <form
            className="settings-row settings-key-row"
            onSubmit={(event) => {
              event.preventDefault();
              const key = apiKey;
              setAPIKey("");
              void saveKey(key).then((saved) => {
                if (saved) setReplacing(false);
              });
            }}
          >
            <input
              aria-label="Ark API Key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={1024}
              value={apiKey}
              onChange={(event) => setAPIKey(event.target.value)}
              placeholder={t("Paste an existing Ark API Key")}
            />
            {replacing && (
              <button
                type="button"
                className="settings-inline-button"
                disabled={busy}
                onClick={() => setReplacing(false)}
              >
                {t("Cancel")}
              </button>
            )}
            <button
              className="settings-inline-button"
              disabled={busy || !apiKey.trim()}
            >
              {t("Save")}
            </button>
          </form>
        ) : (
          status?.ready && (
            <button
              className="settings-row settings-nav-row"
              disabled={busy}
              onClick={() => setReplacing(true)}
            >
              <span>{t("Replace API key")}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )
        )}
        {status?.ready && (
          <button
            className="settings-row settings-nav-row settings-danger-row"
            disabled={busy}
            onClick={removeKey}
          >
            <span>{t("Remove API key from my account")}</span>
          </button>
        )}
      </div>
      <p className="settings-footnote">
        {t(
          "Your assistant runs on Ark Managed Agents with your own key. Real calls may be billed.",
        )}
      </p>
      {status?.ready && <WorkspacePanel client={client} compact />}
      <div className="settings-group settings-gap">
        <button
          className="settings-row settings-nav-row"
          disabled={busy || !owner}
          onClick={() => void exportData()}
        >
          <span>{t("Export my data")}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-footnote">
        {t(
          "Saves a JSON copy of everything the Open Muse service keeps for this account: settings, devices, background work, Feed, and reminder delivery. Your Ark API key is shown only by its last four characters. Keep the file private.",
        )}
      </p>
      <div className="settings-group settings-gap">
        <button
          className="settings-row settings-nav-row"
          disabled={busy}
          onClick={onSignOut}
        >
          <span>{t("Sign out of Open Muse")}</span>
        </button>
        <button
          className="settings-row settings-nav-row settings-danger-row"
          disabled={busy || !owner}
          onClick={deleteAccount}
        >
          <span>{t("Delete account")}</span>
        </button>
      </div>
      <p className="settings-footnote">
        {t(
          "Permanently delete my Open Muse account with its saved Ark API key, workspace settings, devices, background work, and reminder delivery. Conversations, memory, and the agent stay in your Ark account. This cannot be undone.",
        )}
      </p>
      {(notice || busy) && (
        <p className="settings-lead settings-after" role="status">
          {notice || t("Working, please don't submit again…")}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {owner && (
        <p className="settings-footnote settings-account-id">
          {t("Account ID: {id}", { id: shownAccountId(owner) })}
        </p>
      )}
    </>
  );
}
