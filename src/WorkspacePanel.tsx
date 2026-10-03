import { t } from "../shared/i18n";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { Client } from "./api";
import type { WorkspaceStatus } from "../shared/types";
import type { AccountWorkspaceComparison } from "../shared/account-workspace";

// A workspace that needs a decision is never shown as simply ready.
function reviewNote(review: NonNullable<WorkspaceStatus["review"]>) {
  return review === "drift"
    ? t(
        "You kept the saved settings, but the agent or environment in Ark may differ from them now or later, because an earlier unconfirmed change may still arrive. Background work stays paused until you save Ark's current settings.",
      )
    : review === "unconfirmed"
      ? t(
          "A workspace settings change is unconfirmed. Open Muse checks it before anything else is changed.",
        )
      : review === "rebuild"
        ? t(
            "A deleted agent or environment cannot be restored because its saved settings reference resources an account cannot use. The saved settings are kept; recreate it with default settings to continue.",
          )
        : t(
            "The workspace settings need your review: they reference resources an account cannot use or differ from what Open Muse saved. Background work stays paused until you decide.",
          );
}

// Settings values are the user's own and shown as they are, in full: saving
// accepts exactly these values.
function shown(value: unknown) {
  if (value === undefined || value === null) return t("Not set");
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

// Ark's current values next to the saved ones, so adopting saves only what
// the user has seen.
function Comparison({ value }: { value: AccountWorkspaceComparison }) {
  return (
    <div className="workspace-comparison">
      <h4>
        {value.kind === "agent"
          ? t("Agent settings")
          : t("Environment settings")}
      </h4>
      {value.differs.length ? (
        value.differs.map((key) => (
          <details key={key}>
            <summary>
              <code>{key}</code>
            </summary>
            <p>{t("Saved")}</p>
            <pre>{shown(value.saved[key])}</pre>
            <p>{t("In Ark now")}</p>
            <pre>{shown(value.current[key])}</pre>
          </details>
        ))
      ) : (
        <p>
          {t(
            "Ark's current settings match the saved ones at the time of this check.",
          )}
        </p>
      )}
      {value.unusable.map((key) => (
        <p key={key} role="alert">
          {t(
            "{field} in Ark references resources an account cannot use, so Ark's current settings cannot be saved.",
            { field: key },
          )}
        </p>
      ))}
      {value.tooLarge && (
        <p role="alert">{t("Ark's current settings are too large to save.")}</p>
      )}
    </div>
  );
}

export function WorkspacePanel({ client }: { client: Client }) {
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<AccountWorkspaceComparison>();
  const [comparisonError, setComparisonError] = useState("");
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
  const reviewing =
    !busy && (status?.review === "settings" || status?.review === "drift");
  // Read again whenever a decision is due, so the values shown are current.
  useEffect(() => {
    setComparison(undefined);
    setComparisonError("");
    if (!reviewing) return;
    let active = true;
    client.compareWorkspaceSettings().then(
      (value) => active && setComparison(value),
      (e) => active && setComparisonError((e as Error).message),
    );
    return () => {
      active = false;
    };
  }, [client, reviewing, status]);
  const preparing = busy || status?.state === "preparing";
  // A decision the user made about a change or a rebuild that needed review.
  async function decide(action: () => Promise<object>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result: { change?: string } = await action();
      setStatus(await client.workspaceStatus());
      if (result.change === "matches_now")
        setNotice(
          t(
            "Ark matched the saved settings when checked. An earlier unconfirmed environment change may still arrive and replace later changes, so the environment is marked as possibly different.",
          ),
        );
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
  const adoptable =
    comparison && !comparison.unusable.length && !comparison.tooLarge;
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
            : status?.review
              ? t("Needs review")
              : status?.state === "ready"
                ? t("Ready")
                : status?.state === "disconnected"
                  ? t("Not connected")
                  : t("Needs setup")}
        </span>
      </div>
      <p role="status">
        {error ||
          (status?.review && reviewNote(status.review)) ||
          status?.message ||
          t("Reading workspace status…")}
      </p>
      {status?.state !== "ready" && status?.state !== "disconnected" && (
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
      )}
      {notice && (
        <p className="background-note" role="status">
          {notice}
        </p>
      )}
      {reviewing && (
        <>
          {comparison ? (
            <Comparison value={comparison} />
          ) : (
            <p className="background-note">
              {comparisonError || t("Reading Ark's current settings…")}
            </p>
          )}
          <p className="background-note">
            {t(
              "Saving the current settings accepts Ark's values as they are when you save them. An earlier unconfirmed change may still arrive later.",
            )}
          </p>
        </>
      )}
      {!busy && status?.review && (
        <div className="background-actions">
          {(status.review === "unconfirmed" || status.review === "drift") && (
            <button
              className="button secondary"
              onClick={() => void decide(() => client.checkWorkspaceSettings())}
            >
              {status.review === "drift"
                ? t("Check the settings again")
                : t("Check the last change")}
            </button>
          )}
          {reviewing && (
            <button
              className="button secondary"
              disabled={!adoptable}
              onClick={() =>
                comparison &&
                void decide(() =>
                  client.checkWorkspaceSettings("adopt", comparison.expected),
                )
              }
            >
              {t("Save the current settings")}
            </button>
          )}
          {status.review === "settings" && (
            <button
              className="button secondary"
              onClick={() =>
                void decide(() => client.checkWorkspaceSettings("discard"))
              }
            >
              {t("Keep the saved settings")}
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
