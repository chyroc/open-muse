import { useCallback, useEffect, useState } from "react";
import { Folder, X } from "lucide-react";
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
  const lead = (
    <p className="settings-lead">
      {t(
        "When computer use is on, your assistant can open files on this Mac that you ask about. Folders you block here are never opened.",
      )}
    </p>
  );
  if (!available)
    return (
      <>
        {lead}
        <div className="settings-group">
          <div className="settings-row">
            <div>
              <strong>{t("Not connected")}</strong>
              <p>{t("Computer use needs the Open Muse Mac app.")}</p>
            </div>
          </div>
        </div>
      </>
    );
  return (
    <>
      {lead}
      <h2>{t("macOS permissions")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Full Disk Access")}</strong>
            <p>
              {t(
                "Lets your assistant open files in protected places such as Mail and Messages data. Most files do not need it.",
              )}
            </p>
          </div>
          {state?.fullDiskAccess ? (
            <span>{t("Allowed")}</span>
          ) : (
            <button
              className="settings-inline-button"
              disabled={!state}
              onClick={() => change(openFullDiskAccess())}
            >
              {t("Open System Settings")}
            </button>
          )}
        </div>
      </div>
      <h2>{t("Blocked folders")}</h2>
      <div className="settings-group">
        {state?.blockedFolders.map((path) => (
          <div className="settings-row settings-blocked-row" key={path}>
            <Folder size={16} />
            <div>
              <strong>{path.split("/").filter(Boolean).at(-1) ?? path}</strong>
              <p>{path}</p>
            </div>
            <button
              className="icon-button"
              aria-label={t("Unblock {name}", { name: path })}
              onClick={() => change(unblockFolder(path))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="settings-row">
          <div>
            <p>
              {t(
                "Your assistant can't open files inside the folders you add here, or the folders themselves.",
              )}
            </p>
          </div>
          <button
            className="settings-inline-button"
            disabled={!state}
            onClick={() => change(blockFolder())}
          >
            {t("Add folder")}
          </button>
        </div>
      </div>
      <h2>{t("App data")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <p>
              {t(
                "This app has no tools that read Mail, Messages, Notes or WhatsApp data, so there is nothing to allow per app.",
              )}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
