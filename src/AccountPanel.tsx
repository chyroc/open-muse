import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, LogOut, UserRound } from "lucide-react";
import type { Client } from "./api";
import { backgroundClient, type BackgroundClient } from "./background-client";
import { SupabaseLoginForm } from "./SupabaseLoginForm";

// The Open Muse account is the user's identity on every device. Signing in or out
// switches which account's Ark key, workspace, and history this app uses.
export function AccountPanel({
  service = backgroundClient,
  client,
  onChanged,
}: {
  service?: BackgroundClient;
  client: Pick<Client, "accountChanged">;
  onChanged: () => void;
}) {
  const [owner, setOwner] = useState(service.accountOwner());
  const [deleteConsent, setDeleteConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  useEffect(() => setOwner(service.accountOwner()), [service]);
  if (!service.accountConfigured()) return null;
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
      setOwner(service.accountOwner());
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
  const unconfirmed = service.accountSessionUnconfirmed();
  const retired = service.retiredConnection();
  return (
    <section className="settings-card account-card">
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <UserRound size={21} />
        </div>
        <div>
          <h2>{t("Open Muse account")}</h2>
          <p>
            {t(
              "Your identity on every device. Your Ark API key, workspace, and history belong to it.",
            )}
          </p>
        </div>
        <span className="small-badge">
          {owner ? t("Signed in") : t("Not signed in")}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="background-note" role="status">
          {notice}
        </p>
      )}
      {retired ? (
        <div className="logout-row">
          <p className="background-note">
            {t(
              "This device still holds a background device token from an earlier version of Open Muse. Device tokens are no longer supported, so it is not used. Remove it from this device to sign in to an Open Muse account.",
            )}
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => service.disconnect())}
          >
            {t("Remove the old device token")}
          </button>
        </div>
      ) : owner || unconfirmed ? (
        <>
          <div className="logout-row">
            <p
              className="background-note account-id"
              role={unconfirmed ? "alert" : undefined}
            >
              {owner
                ? t("Account ID: {id}", {
                    id: owner.slice("muse_user_".length),
                  })
                : t(
                    "The last session renewal could not be confirmed, so this session is no longer used. Sign out of Open Muse and sign in again.",
                  )}
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
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
                })
              }
            >
              <LogOut size={15} />
              {t("Sign out of Open Muse")}
            </button>
            <small>
              {t(
                "Signs out this device and ends this session at the account service. Other devices stay signed in. Nothing is deleted.",
              )}
            </small>
          </div>
          {owner && (
            <div className="account-delete">
              <label className="background-consent background-remove-consent">
                <input
                  type="checkbox"
                  checked={deleteConsent}
                  disabled={busy}
                  onChange={(event) => setDeleteConsent(event.target.checked)}
                />
                {t(
                  "Permanently delete my Open Muse account with its saved Ark API key, workspace settings, devices, background work, and reminder delivery. Conversations, memory, and the agent stay in your Ark account. This cannot be undone.",
                )}
              </label>
              <button
                className="button danger"
                disabled={busy || !deleteConsent}
                onClick={() =>
                  void run(async () => {
                    try {
                      await service.deleteAccount();
                    } finally {
                      setDeleteConsent(false);
                    }
                    await switched();
                    setNotice(t("Your Open Muse account was deleted."));
                  })
                }
              >
                {t("Delete account")}
              </button>
            </div>
          )}
        </>
      ) : (
        <SupabaseLoginForm
          busy={busy}
          onSignIn={(email, password) =>
            run(async () => {
              await service.signInAccount(email, password);
              await switched();
            })
          }
          onSignUp={async (email, password) => {
            let submitted = false;
            await run(async () => {
              await service.signUpAccount(email, password);
              submitted = true;
              // Without email verification the new account can sign in at
              // once, through the ordinary sign-in; the signup response itself
              // is never adopted as a session.
              try {
                await service.signInAccount(email, password);
              } catch {
                setNotice(
                  t(
                    "Registration submitted. Check your email if verification is required, then sign in. This does not confirm that a new account was created.",
                  ),
                );
                return;
              }
              await switched();
            });
            return submitted;
          }}
          onRequestReset={async (email) => {
            let sent = false;
            await run(async () => {
              await service.requestPasswordReset(email);
              sent = true;
            });
            return sent;
          }}
          onReset={(email, code, password) =>
            run(async () => {
              await service.resetPassword(email, code, password);
              try {
                await service.signInAccount(email, password);
              } catch {
                setNotice(
                  t(
                    "Your password was changed. Sign in with the new password.",
                  ),
                );
                return;
              }
              await switched();
            })
          }
        />
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
