import { useCallback, useEffect, useState } from "react";
import { Folder, HardDrive, X } from "lucide-react";
import { PermissionRow } from "./ComputerSettings";
import { t } from "../../shared/i18n";
import {
  blockFolder,
  computerAvailable,
  computerChanged,
  openFullDiskAccess,
  readComputer,
  unblockFolder,
  type ComputerState,
} from "./computer";

// What computer use may reach on disk. Full Disk Access is macOS's own
// switch; blocked folders are refused whenever the assistant opens a file.
export function FileSystemSettings() {
  const [state, setState] = useState<ComputerState>();
  const [error, setError] = useState("");
  const available = computerAvailable();
  const refresh = useCallback(
    () =>
      void readComputer()
        .then((value) => value && setState(value))
        .catch(() => setError(t("Could not read the app settings."))),
    [],
  );
  useEffect(() => {
    if (!available) return;
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(computerChanged, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(computerChanged, refresh);
    };
  }, [available, refresh]);
  const change = (request: Promise<ComputerState | undefined>) =>
    void request
      .then((value) => value && setState(value))
      .catch(() => setError(t("Could not change the app settings.")));
  if (!available)
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Not connected")}</strong>
            <p>{t("Computer use needs the Open Muse Mac app.")}</p>
          </div>
        </div>
      </div>
    );
  return (
    <>
      <section>
        <h2>{t("Permissions required")}</h2>
        <div className="settings-group computer-permissions">
          <PermissionRow
            icon={HardDrive}
            title={t("Full Disk Access")}
            granted={state?.fullDiskAccess}
            disabled={!state}
            onOpen={() => change(openFullDiskAccess())}
          />
        </div>
        <p className="settings-footnote">
          {t(
            "Full Disk Access enables Open Muse to read and interact with your files and apps.",
          )}
        </p>
      </section>
      <div className="permission-settings-controls">
        <section>
          <h2>{t("Blocked folders")}</h2>
          <div className="settings-group computer-blocked">
            {state?.blockedFolders.map((path) => (
              <div className="computer-blocked-row" key={path} title={path}>
                <Folder size={16} aria-hidden="true" />
                <span>{path.split("/").filter(Boolean).at(-1) ?? path}</span>
                <button
                  className="icon-button"
                  aria-label={t("Unblock {name}", { name: path })}
                  onClick={() => change(unblockFolder(path))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <button
              className="computer-add-app"
              disabled={!state}
              onClick={() => change(blockFolder())}
            >
              {t("Add folder")}
            </button>
          </div>
          <p className="settings-footnote">
            {t("Open Muse can't see or use the folders you add here.")}
          </p>
        </section>
        <section>
          <h2>{t("App data")}</h2>
          <p className="settings-footnote">
            {t(
              "This app has no tools that read Mail, Messages, Notes or WhatsApp data, so there is nothing to allow per app.",
            )}
          </p>
        </section>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
