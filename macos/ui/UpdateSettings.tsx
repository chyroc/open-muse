import { useEffect, useRef, useState } from "react";
import { formatLocale, t } from "../../shared/i18n";
import { Switch } from "./SettingsSwitch";
import {
  sendUpdate,
  setAutomaticUpdates,
  updateChanged,
  updateReveal,
  updatesAvailable,
  type UpdateOperation,
  type UpdateState,
} from "./update";

// The Updates rows under About: where the app's own update stands, the one
// action that moves it on, and whether it happens on its own. The rows show
// what the shell reports, never a guess.
export function UpdateSettings() {
  const [state, setState] = useState<UpdateState>();
  const [pending, setPending] = useState(false);
  const rows = useRef<HTMLDivElement>(null);
  const available = updatesAvailable();
  useEffect(() => {
    if (!available) return;
    let alive = true;
    const refresh = () =>
      void sendUpdate("read")
        .then((value) => alive && value && setState(value))
        .catch(() => {});
    const reveal = () =>
      rows.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    refresh();
    window.addEventListener(updateChanged, refresh);
    window.addEventListener(updateReveal, reveal);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener(updateChanged, refresh);
      window.removeEventListener(updateReveal, reveal);
      window.removeEventListener("focus", refresh);
    };
  }, [available]);
  if (!available || state?.supported === false)
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Updates")}</strong>
            <p>
              {t(
                "This build doesn't update itself. Releases from getopenmuse.com do.",
              )}
            </p>
          </div>
        </div>
      </div>
    );
  function send(operation: UpdateOperation) {
    setPending(true);
    void sendUpdate(operation)
      .then((next) => next && setState(next))
      .catch(() => {})
      .finally(() => setPending(false));
  }
  const { title, detail, action } = describe(state);
  return (
    <div className="settings-group" ref={rows}>
      <div className="settings-row settings-update-row" aria-live="polite">
        <div>
          <strong>{title}</strong>
          {detail && <p>{detail}</p>}
        </div>
        {action && (
          <button
            className="settings-inline-button"
            disabled={pending}
            onClick={() => send(action.operation)}
          >
            {action.label}
          </button>
        )}
      </div>
      {state?.phase === "downloading" && (
        <div
          className="settings-update-progress"
          role="progressbar"
          aria-label={t("Download progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress * 100)}
        >
          <span style={{ width: `${state.progress * 100}%` }} />
        </div>
      )}
      <Switch
        label={t("Update automatically")}
        detail={t(
          "Checks for a new version every few hours and downloads it in the background. It installs when you quit Open Muse.",
        )}
        checked={state?.automatic ?? true}
        disabled={!state || pending}
        onChange={(value) => {
          setPending(true);
          void setAutomaticUpdates(value)
            .then((next) => next && setState(next))
            .catch(() => {})
            .finally(() => setPending(false));
        }}
      />
    </div>
  );
}

function describe(state: UpdateState | undefined): {
  title: string;
  detail?: string;
  action?: { label: string; operation: UpdateOperation };
} {
  const check = { label: t("Check now"), operation: "check" as const };
  const release =
    state?.version && state.build
      ? `${state.version} (${state.build})`
      : (state?.version ?? "");
  switch (state?.phase) {
    case undefined:
      return { title: t("Updates") };
    case "checking":
      return { title: t("Checking for updates…") };
    case "current":
      return {
        title: t("Open Muse is up to date"),
        detail: state.checkedAt
          ? t("Last checked {time}", {
              time: new Date(state.checkedAt).toLocaleString(formatLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })
          : undefined,
        action: check,
      };
    case "available":
      return state.installable
        ? {
            title: t("Version {version} is available", { version: release }),
            action: { label: t("Download and install"), operation: "download" },
          }
        : {
            title: t("Version {version} is available", { version: release }),
            detail: t(
              "Open Muse can't replace itself where it is now. Move it to the Applications folder, or download the new version.",
            ),
            action: { label: t("Download"), operation: "download" },
          };
    case "downloading":
      return {
        title: t("Downloading version {version}…", { version: release }),
        detail: `${Math.round(state.progress * 100)}%`,
      };
    case "ready":
      return {
        title: t("Version {version} is ready", { version: release }),
        detail: t("It installs when you quit Open Muse."),
        action: { label: t("Restart to update"), operation: "restart" },
      };
    case "failed":
      return state.failure === "check"
        ? {
            title: t("Couldn't check for updates"),
            detail: t("Check your internet connection and try again."),
            action: { label: t("Try again"), operation: "check" },
          }
        : {
            title:
              state.failure === "verify"
                ? t("The update couldn't be verified, so it wasn't installed")
                : t("Couldn't download the update"),
            action: { label: t("Try again"), operation: "download" },
          };
    default:
      return {
        title: t("Updates"),
        detail: t("Checks a little after Open Muse starts."),
        action: check,
      };
  }
}
