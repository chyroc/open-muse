import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { Modal } from "./Chrome";
import {
  downloadAgentData,
  draftInMainChat,
  memoryExportPrompt,
  memoryImportDraft,
} from "./dataControls";

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
  return (
    <>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Import memory")}</strong>
            <p>
              {t(
                "Bring what another assistant knows about you. You review the message before your companion saves anything.",
              )}
            </p>
          </div>
          <button
            className="settings-inline-button"
            disabled={!signedIn}
            onClick={() => setImporting(true)}
          >
            {t("Import")}
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>{t("Download your data")}</strong>
            <p>
              {t(
                "Saves memory, goals, Upcoming and every conversation as one Markdown file. It only reads from your Ark project.",
              )}
            </p>
          </div>
          <button
            className="settings-inline-button"
            disabled={!signedIn || busy}
            onClick={() => {
              setBusy(true);
              setError("");
              setNotice("");
              abort.current = new AbortController();
              void client
                .companionIdentity()
                .then((identity) =>
                  downloadAgentData(
                    client,
                    identity.name,
                    abort.current!.signal,
                  ),
                )
                .then(setNotice)
                .catch((failure: Error) => setError(failure.message))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? t("Preparing…") : t("Download")}
          </button>
        </div>
      </div>
      {notice && <p className="settings-lead settings-after">{notice}</p>}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
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
