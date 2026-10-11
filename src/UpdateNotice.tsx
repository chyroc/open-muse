import { useEffect, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import { t } from "../shared/i18n";
import {
  automaticDownloads,
  checkForUpdate,
  currentBuild,
  dismissUpdate,
  dismissedBuild,
  setAutomaticDownloads,
  startUpdate,
  subscribeUpdate,
  updatePlatform,
  updateState,
  type UpdateFeed,
} from "./app-update";

function useUpdate() {
  return useSyncExternalStore(subscribeUpdate, updateState, updateState);
}

// Checks at launch and on returning to the app; the check itself keeps to at
// most every six hours.
export function useAutomaticUpdateCheck() {
  useEffect(() => {
    if (!updatePlatform() || !currentBuild()) return;
    const check = () => {
      if (!document.hidden) void checkForUpdate({ automatic: true });
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
}

// The iPhone's marketing version stays the same across TestFlight builds, so
// the build number tells them apart; Android's version already does.
function versionLabel(feed: UpdateFeed) {
  return updatePlatform() === "ios"
    ? `${feed.version} (${feed.build})`
    : feed.version;
}

function actionLabel(phase: string, ios: boolean) {
  if (ios) return t("Update in TestFlight");
  return phase === "ready" ? t("Install update") : t("Download and install");
}

// A quiet notice above the chat when a newer release is out, until the
// person updates or hides it for that release.
export function UpdateNotice() {
  const state = useUpdate();
  const ios = updatePlatform() === "ios";
  const feed = state.feed;
  if (
    !feed ||
    feed.build <= currentBuild() ||
    feed.build <= dismissedBuild() ||
    !["available", "downloading", "ready"].includes(state.phase)
  )
    return null;
  return (
    <div className="update-notice" role="status">
      <Download size={16} aria-hidden="true" />
      <span>
        {state.phase === "downloading"
          ? t("Downloading version {version}…", { version: versionLabel(feed) })
          : state.permission
            ? t(
                "Allow Open Muse to install apps, then tap Install update again.",
              )
            : t("Version {version} is available", {
                version: versionLabel(feed),
              })}
      </span>
      {state.phase !== "downloading" && (
        <button
          className="update-notice-action"
          onClick={() => void startUpdate()}
        >
          {actionLabel(state.phase, ios)}
        </button>
      )}
      <button
        className="update-notice-close"
        aria-label={t("Not now")}
        onClick={dismissUpdate}
      >
        <X size={16} />
      </button>
    </div>
  );
}

// About's update rows: where the check stands, the action, and on Android
// whether releases download on their own.
export function UpdateRows() {
  const state = useUpdate();
  const platform = updatePlatform();
  if (!platform || !currentBuild()) return null;
  const ios = platform === "ios";
  const feed = state.feed;
  const newer = Boolean(feed && feed.build > currentBuild());
  const status =
    state.phase === "checking"
      ? t("Checking for updates…")
      : state.phase === "downloading" && feed
        ? t("Downloading version {version}…", { version: versionLabel(feed) })
        : state.phase === "failed"
          ? state.failure === "check"
            ? t("Couldn't check for updates")
            : state.failure === "install"
              ? t("The installer couldn't open")
              : t("Couldn't download the update")
          : newer && feed
            ? state.phase === "ready" && !ios
              ? t("Version {version} is ready", { version: versionLabel(feed) })
              : t("Version {version} is available", {
                  version: versionLabel(feed),
                })
            : state.phase === "current"
              ? t("Open Muse is up to date")
              : "";
  return (
    <>
      <li>
        <div className="settings-list-row update-row">
          <span className="settings-row-text">
            {t("Updates")}
            {status && <small role="status">{status}</small>}
            {state.permission && (
              <small>
                {t(
                  "Allow Open Muse to install apps, then tap Install update again.",
                )}
              </small>
            )}
          </span>
          {newer && state.phase !== "downloading" ? (
            <button
              className="update-row-action"
              onClick={() => void startUpdate()}
            >
              {actionLabel(state.phase, ios)}
            </button>
          ) : (
            <button
              className="update-row-action"
              disabled={["checking", "downloading"].includes(state.phase)}
              onClick={() => void checkForUpdate()}
            >
              {state.phase === "failed" ? t("Try again") : t("Check now")}
            </button>
          )}
        </div>
      </li>
      {!ios && (
        <li>
          <label className="settings-list-row">
            <span className="settings-row-text">
              {t("Download updates automatically")}
              <small>
                {t("Android always asks before installing an update.")}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="ios-switch"
              defaultChecked={automaticDownloads()}
              onChange={(event) => setAutomaticDownloads(event.target.checked)}
            />
          </label>
        </li>
      )}
    </>
  );
}
