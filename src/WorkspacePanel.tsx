import { t } from "../shared/i18n";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { Client } from "./api";
import type { WorkspaceStatus } from "../shared/types";

export function WorkspacePanel({ client }: { client: Client }) {
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await client.workspaceStatus();
        if (!abort.signal.aborted) {
          setStatus(value);
          setError("");
        }
        if (value.state === "preparing" && !abort.signal.aborted)
          timer = setTimeout(() => void read(), 1000);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, busy]);
  const preparing = busy || status?.state === "preparing";
  // A decision the user made about a change or a rebuild that needed review.
  async function decide(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setStatus(await client.startWorkspace());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (busy || (preparing && !error)) return;
    setBusy(true);
    setError("");
    try {
      setStatus(
        await (!status || error
          ? client.workspaceStatus()
          : client.startWorkspace({
              // The user chose to continue after an interrupted setup.
              replaceUnconfirmed: status.state === "error",
            })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card" aria-label={t("Personal workspace")}>
      <div className="workspace-heading">
        {preparing ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <Check size={20} />
        )}
        <div>
          <h3>{t("Personal workspace")}</h3>
          <p>
            {t(
              "The assistant and runtime are managed automatically by Muse, no manual setup needed.",
            )}
          </p>
          <p>
            {t(
              "The cloud environment can access the public internet; tools in new tasks run directly by default and may cause external writes, deletions, or charges.",
            )}
          </p>
        </div>
        <span className="small-badge">
          {preparing
            ? t("Preparing")
            : status?.state === "ready"
              ? t("Ready")
              : status?.state === "disconnected"
                ? t("Not connected")
                : t("Needs setup")}
        </span>
      </div>
      <p role="status">
        {error || status?.message || t("Reading workspace status…")}
      </p>
      {status?.state === "ready" ? (
        <a className="button primary" href="#/">
          {t("Start something new")}
        </a>
      ) : (
        status?.state !== "disconnected" && (
          <button
            className="button secondary"
            disabled={busy || (preparing && !error)}
            onClick={() => void prepare()}
          >
            {preparing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            {error
              ? t("Read status again")
              : preparing
                ? t("Setting up automatically…")
                : status?.state === "error"
                  ? t("Continue setup")
                  : t("Set up workspace")}
          </button>
        )
      )}
      {!busy && status?.review && (
        <div className="background-actions">
          {status.review === "unconfirmed" && (
            <button
              className="button secondary"
              onClick={() => void decide(() => client.checkWorkspaceSettings())}
            >
              {t("Check the last change")}
            </button>
          )}
          {status.review === "settings" && (
            <button
              className="button secondary"
              onClick={() =>
                void decide(() => client.checkWorkspaceSettings(true))
              }
            >
              {t("Save the current settings")}
            </button>
          )}
          {status.review === "rebuild" && (
            <button
              className="button secondary"
              onClick={() =>
                void decide(() =>
                  client.startWorkspace({ resetSettings: true }),
                )
              }
            >
              {t("Recreate with default settings")}
            </button>
          )}
        </div>
      )}
      {status?.state === "disconnected" && (
        <a className="button secondary" href="#/settings">
          {t("Sign in and connect a project")}
        </a>
      )}
    </section>
  );
}
