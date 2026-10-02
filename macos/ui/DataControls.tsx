import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { Modal } from "./Chrome";
import {
  downloadAgentData,
  draftInMainChat,
  memoryExportPrompt,
  memoryImportDraft,
} from "./dataExport";
import { resetThisMac } from "./presence";

// Bring memory in from another assistant, or take everything out as a file.
// Neither changes anything in MA by itself.
export function DataControls({ client }: { client: Client }) {
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController>(undefined);
  useEffect(() => () => abort.current?.abort(), []);
  const signedIn = client.signedIn();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Removes this Mac's logins, records and preferences, then the shell starts
  // the app over. Nothing in the cloud is deleted.
  async function reset() {
    setConfirmReset(false);
    setResetting(true);
    setError("");
    try {
      await client.resetDevice();
      if (!(await resetThisMac())) location.reload();
    } catch (failure) {
      setError((failure as Error).message);
      setResetting(false);
    }
  }
  const download = () => {
    setBusy(true);
    setError("");
    setNotice("");
    abort.current = new AbortController();
    void client
      .companionIdentity()
      .then((identity) =>
        downloadAgentData(client, identity.name, abort.current!.signal),
      )
      .then(setNotice)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="settings-group">
        <button
          className="settings-row settings-nav-row"
          disabled={!signedIn}
          onClick={() => setImporting(true)}
        >
          <span>{t("Import memory")}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button
          className="settings-row settings-nav-row"
          disabled={!signedIn || busy}
          onClick={download}
        >
          <span>{busy ? t("Preparing…") : t("Download your agent data")}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-footnote">
        {t(
          "Import brings what another assistant knows about you; you review the message before your companion saves anything. Download saves memory, goals, Upcoming and every conversation as one Markdown file, reading only from your Ark project.",
        )}
      </p>
      <div className="settings-group settings-gap">
        <button
          className="settings-row settings-nav-row settings-danger-row"
          disabled={resetting}
          onClick={() => setConfirmReset(true)}
        >
          <span>{resetting ? t("Resetting…") : t("Reset this device")}</span>
        </button>
      </div>
      <p className="settings-footnote">
        {t(
          "Removes the saved Ark API key, sign-ins, local data and settings from this Mac. Your agents, conversations and memory in the cloud stay.",
        )}
      </p>
      {notice && <p className="settings-lead settings-after">{notice}</p>}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {confirmReset && (
        <Modal
          title={t("Reset this device")}
          onClose={() => setConfirmReset(false)}
        >
          <p>
            {t(
              "Reset this device? This removes the saved Ark API key and sign-ins from this device and deletes all local data, including the conversation list, saved replies, Feed, and settings. Open Muse restarts as if newly installed. Your agents, conversations, and memory in the cloud are not deleted.",
            )}
          </p>
          <p>
            {t(
              "Permissions you gave Open Muse in macOS System Settings stay there.",
            )}
          </p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              onClick={() => setConfirmReset(false)}
            >
              {t("Cancel")}
            </button>
            <button className="pill-button danger" onClick={() => void reset()}>
              {t("Reset")}
            </button>
          </div>
        </Modal>
      )}
      {importing && (
        <Modal title={t("Import memory")} onClose={() => setImporting(false)}>
          <ol className="memory-import">
            <li>
              <p>{t("Ask your other assistant with this prompt:")}</p>
              <blockquote>{memoryExportPrompt()}</blockquote>
              <button
                className="pill-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(memoryExportPrompt())
                    .then(() => setNotice(t("Prompt copied")))
                }
              >
                {t("Copy prompt")}
              </button>
            </li>
            <li>
              <p>{t("Paste its answer here:")}</p>
              <textarea
                rows={8}
                maxLength={14000}
                value={pasted}
                aria-label={t("What the other assistant remembers")}
                onChange={(event) => setPasted(event.target.value)}
              />
            </li>
          </ol>
          <div className="feed-dialog-actions">
            <button className="pill-button" onClick={() => setImporting(false)}>
              {t("Cancel")}
            </button>
            <button
              className="pill-button primary"
              disabled={!pasted.trim()}
              onClick={() => {
                if (!draftInMainChat(memoryImportDraft(pasted)))
                  return setError(t("Open the Mac app to continue."));
                setImporting(false);
                setPasted("");
              }}
            >
              {t("Draft in main chat")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
