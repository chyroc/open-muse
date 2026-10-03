import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { t } from "../shared/i18n";
import type { Client } from "./api";
import { backgroundClient, type BackgroundClient } from "./background-client";
import { exportText } from "./platform";
import { Sheet } from "./MusePages";
import { WebhooksSettings } from "./WebhooksSettings";
import { WorkspacePanel } from "./WorkspacePanel";
import "./account-sheet.css";

interface Status {
  ready: boolean;
  project?: string;
}

// Account and workspace for a signed-in Open Muse account, as grouped rows:
// who is signed in, the Ark API key the account keeps, the workspace, and
// webhooks, then the actions that remove things, each confirmed by the system
// before it runs.
export function AccountSheet({
  client,
  onClose,
  onChanged,
  service = backgroundClient,
}: {
  client: Client;
  onClose: () => void;
  onChanged: () => void;
  service?: BackgroundClient;
}) {
  const [status, setStatus] = useState<Status>();
  const [replacing, setReplacing] = useState(false);
  const [apiKey, setAPIKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const owner = service.accountOwner();
  const email = service.accountEmail();
  const refresh = async () => setStatus(await client.auth<Status>("status"));
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [client]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Whatever happened at the service, the app must not keep running with the
  // previous account's key or workspace.
  async function switched() {
    try {
      await client.accountChanged();
    } finally {
      onChanged();
    }
  }
  const signOut = () =>
    run(async () => {
      let revoked = false;
      try {
        revoked = (await service.signOutAccount()).revoked;
      } finally {
        await switched();
      }
      if (!revoked)
        setNotice(
          t(
            "Signed out on this device. The account service could not confirm ending the session; it expires on its own.",
          ),
        );
      else onClose();
    });
  const removeKey = () => {
    if (
      !confirm(
        t(
          "Remove the key from my Open Muse account on all devices and stop background work that uses it. The key stays valid at Ark until you revoke it there.",
        ),
      )
    )
      return;
    void run(async () => {
      await client.auth("logout", { confirm: true });
      await refresh();
      onChanged();
    });
  };
  const deleteAccount = () => {
    if (
      !confirm(
        t(
          "Permanently delete my Open Muse account with its saved Ark API key, workspace settings, devices, background work, and reminder delivery. Conversations, memory, and the agent stay in your Ark account. This cannot be undone.",
        ),
      )
    )
      return;
    void run(async () => {
      await service.deleteAccount();
      await switched();
      setNotice(t("Your Open Muse account was deleted."));
    });
  };
  const exportData = () =>
    run(async () => {
      const data = await service.exportAccount();
      const day = new Date(data.exportedAt).toISOString().slice(0, 10);
      setNotice(
        await exportText(
          `open-muse-account-${day}.json`,
          JSON.stringify(data, null, 2),
          {
            saved: t("Your data was saved"),
            dialogTitle: t("Export my data"),
            downloaded: t("Your data download started"),
            type: "application/json;charset=utf-8",
          },
        ),
      );
    });
  const label = email ?? t("Open Muse account");
  return (
    <Sheet title={t("Account and workspace")} onClose={onClose} grouped>
      <div className="account-hero">
        <span className="account-avatar" aria-hidden="true">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <h2>{label}</h2>
        {owner && (
          <p>
            {t("Account ID: {id}", { id: owner.slice("muse_user_".length) })}
          </p>
        )}
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
                void run(async () => {
                  try {
                    await client.auth("api-key", {
                      apiKey: apiKey.trim(),
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
                <span className="settings-row-text">
                  {t("Replace API key")}
                </span>
              </button>
            </li>
          )
        )}
      </ul>
      <p className="settings-footnote">
        {t(
          "Your assistant runs on Ark Managed Agents with your own key. Real calls may be billed.",
        )}
      </p>
      {status?.ready && (
        <>
          <h3 className="settings-group-title">{t("Personal workspace")}</h3>
          <WorkspacePanel client={client} />
        </>
      )}
      <WebhooksSettings service={service} />
      <ul className="settings-list account-actions">
        <li>
          <button
            className="settings-list-row account-link-row"
            disabled={busy || !owner}
            onClick={() => void exportData()}
          >
            <span className="settings-row-text">
              {t("Export my data")}
              <small>
                {t(
                  "Saves a JSON copy of everything the Open Muse service keeps for this account: settings, devices, background work, Feed, and reminder delivery. Your Ark API key is shown only by its last four characters. Keep the file private.",
                )}
              </small>
            </span>
          </button>
        </li>
        <li>
          <button
            className="settings-list-row account-link-row"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <span className="settings-row-text">
              {t("Sign out of Open Muse")}
            </span>
          </button>
        </li>
      </ul>
      <ul className="settings-list account-actions">
        {status?.ready && (
          <li>
            <button
              className="settings-list-row settings-destructive"
              disabled={busy}
              onClick={removeKey}
            >
              <span>{t("Remove API key from my account")}</span>
            </button>
          </li>
        )}
        <li>
          <button
            className="settings-list-row settings-destructive"
            disabled={busy || !owner}
            onClick={deleteAccount}
          >
            <span>{t("Delete account")}</span>
          </button>
        </li>
      </ul>
      {busy && (
        <p className="settings-footnote" role="status">
          <LoaderCircle className="spin" size={15} />{" "}
          {t("Working, please don't submit again…")}
        </p>
      )}
    </Sheet>
  );
}
