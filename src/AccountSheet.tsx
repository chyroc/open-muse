import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { t } from "../shared/i18n";
import type { Client } from "./api";
import { backgroundClient, type BackgroundClient } from "./background-client";
import { Sheet } from "./MusePages";
import { shownAccountId, useAccount } from "./useAccount";
import { WorkspacePanel } from "./WorkspacePanel";
import "./account-sheet.css";

// A signed-in Open Muse account, as grouped rows: who is signed in, the Ark
// API key the account keeps, exporting its data, then signing out and the
// actions that remove things, each confirmed by the system before it runs.
// The workspace prepares itself and shows here only when it needs attention.
export function AccountSheet({
  client,
  onClose,
  onChanged,
  onReset,
  service = backgroundClient,
}: {
  client: Client;
  onClose: () => void;
  onChanged: () => void;
  // Opens the confirmation that resets this device.
  onReset?: () => void;
  service?: BackgroundClient;
}) {
  const {
    status,
    owner,
    email,
    busy,
    error,
    notice,
    saveKey,
    signOut,
    removeKey,
    deleteAccount,
    exportData,
  } = useAccount({ client, onChanged, onSignedOut: onClose, service });
  const [replacing, setReplacing] = useState(false);
  const [apiKey, setAPIKey] = useState("");
  const label = email ?? t("Open Muse account");
  return (
    <Sheet title={t("Open Muse account")} onClose={onClose} grouped>
      <div className="account-hero">
        <AccountAvatar label={label} />
        {/* A long email may wrap, and then before its domain. */}
        <h2>
          {label.includes("@") ? (
            <>
              {label.slice(0, label.indexOf("@"))}
              <wbr />
              {label.slice(label.indexOf("@"))}
            </>
          ) : (
            label
          )}
        </h2>
      </div>
      {error && (
        <p className="settings-footnote" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-footnote" role="status">
          {notice}
        </p>
      )}
      <h3 className="settings-group-title">Ark API Key</h3>
      <ul className="settings-list">
        <li>
          <div className="settings-list-row">
            <span className="settings-row-text">
              {status?.ready
                ? t("Saved in your Open Muse account")
                : t("Not connected")}
              {status?.project && (
                <small>
                  {t("Project")} {status.project}
                </small>
              )}
            </span>
            {status?.ready && (
              <span className="settings-row-value">{t("Connected")}</span>
            )}
          </div>
        </li>
        {status && (!status.ready || replacing) ? (
          <li>
            <form
              className="account-key-form"
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
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={1024}
                value={apiKey}
                onChange={(event) => setAPIKey(event.target.value)}
                placeholder={t("Paste an existing Ark API Key")}
              />
              <div>
                {replacing && (
                  <button
                    type="button"
                    className="settings-row-action"
                    disabled={busy}
                    onClick={() => setReplacing(false)}
                  >
                    {t("Cancel")}
                  </button>
                )}
                <button
                  className="settings-row-action"
                  disabled={busy || !apiKey.trim()}
                >
                  {t("Save")}
                </button>
              </div>
            </form>
          </li>
        ) : (
          status?.ready && (
            <li>
              <button
                className="settings-list-row account-link-row"
                disabled={busy}
                onClick={() => setReplacing(true)}
              >
                <span>{t("Replace API key")}</span>
              </button>
            </li>
          )
        )}
        {status?.ready && (
          <li>
            <button
              className="settings-list-row account-danger-row"
              disabled={busy}
              onClick={removeKey}
            >
              <span>{t("Remove API key from my account")}</span>
            </button>
          </li>
        )}
      </ul>
      <p className="settings-footnote">
        {t(
          "Your assistant runs on Ark Managed Agents with your own key. Real calls may be billed.",
        )}
      </p>
      {status?.ready && <WorkspacePanel client={client} compact />}
      <ul className="settings-list account-actions">
        <li>
          <button
            className="settings-list-row account-link-row"
            disabled={busy || !owner}
            onClick={() => void exportData()}
          >
            <span>{t("Export my data")}</span>
          </button>
        </li>
      </ul>
      <p className="settings-footnote">
        {t(
          "Saves a JSON copy of everything the Open Muse service keeps for this account: settings, devices, background work, Feed, and reminder delivery. Your Ark API key is shown only by its last four characters. Keep the file private.",
        )}
      </p>
      <ul className="settings-list account-actions">
        <li>
          <button
            className="settings-list-row account-danger-row"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <span>{t("Sign out of Open Muse")}</span>
          </button>
        </li>
        <li>
          <button
            className="settings-list-row account-danger-row"
            disabled={busy || !owner}
            onClick={deleteAccount}
          >
            <span>{t("Delete account")}</span>
          </button>
        </li>
        {onReset && (
          <li>
            <button
              className="settings-list-row account-danger-row"
              disabled={busy}
              onClick={onReset}
            >
              <span>{t("Reset this device")}</span>
            </button>
          </li>
        )}
      </ul>
      {busy && (
        <p className="settings-footnote" role="status">
          <LoaderCircle className="spin" size={15} />{" "}
          {t("Working, please don't submit again…")}
        </p>
      )}
      {owner && (
        <p className="account-id">
          {t("Account ID: {id}", { id: shownAccountId(owner) })}
        </p>
      )}
    </Sheet>
  );
}

// The account's initial on a tinted disc, in the page's accent color.
export function AccountAvatar({
  label,
  small = false,
}: {
  label: string;
  small?: boolean;
}) {
  return (
    <span
      className={small ? "account-avatar small" : "account-avatar"}
      aria-hidden="true"
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
