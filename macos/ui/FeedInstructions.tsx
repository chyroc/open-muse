import { t } from "../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { Client } from "../../src/api";
import {
  defaultFeedInstructions,
  type InspirationSnapshot,
} from "../../shared/inspiration";
import { Modal } from "./Chrome";

type Instructions = InspirationSnapshot["instructions"];
// The built-in default is shown in the interface language; anything the person
// wrote is shown as written. Saving still requires an actual edit.
export const shownInstructions = (content: string) =>
  content.trim() === defaultFeedInstructions
    ? t(defaultFeedInstructions)
    : content;
export function FeedInstructions({
  client,
  initial,
  onSaved,
  onClose,
}: {
  client: Client;
  initial: Instructions;
  onSaved: (value: Instructions) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(shownInstructions(initial.content));
  const [baseline, setBaseline] = useState(initial);
  const [remote, setRemote] = useState<Instructions>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const guard = useRef(false);
  const dirty = draft.trim() !== shownInstructions(baseline.content).trim();
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const target = window as Window & {
      __OPEN_MUSE_HAS_UNSAVED_DOCUMENT__?: boolean;
      __OPEN_MUSE_DOCUMENT_SAVING__?: boolean;
    };
    target.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = dirty || busy;
    target.__OPEN_MUSE_DOCUMENT_SAVING__ = busy;
    const key = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    const discard = () => {
      if (!guard.current) closeRef.current();
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("muse-discard-document", discard);
    window.addEventListener("beforeunload", leave);
    return () => {
      target.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = false;
      target.__OPEN_MUSE_DOCUMENT_SAVING__ = false;
      window.removeEventListener("keydown", key);
      window.removeEventListener("muse-discard-document", discard);
      window.removeEventListener("beforeunload", leave);
    };
  }, [dirty, busy]);
  async function save() {
    if (guard.current || !dirty || !draft.trim() || !client.signedIn()) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await client.saveFeedInstructions(draft, baseline.revision));
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  saveRef.current = save;
  async function review() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      setRemote((await client.inspiration()).instructions);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const close = () => {
    if (!guard.current) dirty ? setConfirmClose(true) : onClose();
  };
  return (
    <Modal
      title={t("Feed instructions")}
      onClose={close}
      className="feed-instructions-dialog"
    >
      <p id="feed-instructions-hint" className="feed-instructions-hint">
        {t(
          "These instructions decide what your feed brings you. Changes apply to the next posts.",
        )}
      </p>
      <form
        className="feed-instructions-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="feed-instructions" className="feed-sr-only">
          {t("What should your feed cover?")}
        </label>
        <textarea
          id="feed-instructions"
          aria-describedby="feed-instructions-hint"
          autoFocus
          rows={12}
          maxLength={4000}
          value={draft}
          disabled={busy || !client.signedIn()}
          placeholder={t("Add instructions…")}
          onFocus={(event) => {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <div className="feed-error" role="alert">
            {error}
            <button type="button" disabled={busy} onClick={() => void review()}>
              {t("Review cloud version")}
            </button>
          </div>
        )}
        {remote && (
          <aside className="feed-cloud-copy">
            <h3>{t("Latest cloud version")}</h3>
            <p>{shownInstructions(remote.content)}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(shownInstructions(remote.content));
                setBaseline(remote);
                setRemote(undefined);
                setError("");
              }}
            >
              {t("Replace draft with this version")}
            </button>
            <p className="subtle">
              {t("Your draft stays unchanged until you choose to replace it.")}
            </p>
          </aside>
        )}
        <footer className="feed-instructions-actions">
          <button
            type="button"
            className="feed-button flat"
            disabled={busy}
            onClick={close}
          >
            {t("Cancel")}
          </button>
          <button
            className="feed-button primary"
            disabled={busy || !dirty || !draft.trim() || !client.signedIn()}
          >
            {busy ? t("Saving…") : t("Save")}
          </button>
        </footer>
      </form>
      {confirmClose && (
        <Modal
          title={t("Discard changes?")}
          onClose={() => setConfirmClose(false)}
        >
          <p>{t("Your feed instructions have unsaved changes.")}</p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              onClick={() => setConfirmClose(false)}
            >
              {t("Keep editing")}
            </button>
            <button className="pill-button" onClick={onClose}>
              {t("Discard changes")}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
