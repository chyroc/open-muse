import { useEffect, useRef, useState } from "react";
import type { Client } from "../../src/api";
import type { InspirationSnapshot } from "../../shared/inspiration";
import { Modal } from "./Chrome";

type Instructions = InspirationSnapshot["instructions"];
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
  const [draft, setDraft] = useState(initial.content);
  const [baseline, setBaseline] = useState(initial);
  const [remote, setRemote] = useState<Instructions>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const guard = useRef(false);
  const dirty = draft.trim() !== baseline.content.trim();
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
    <Modal title="Feed instructions" onClose={close}>
      <p>
        Your feed is powered by the instructions below. Any edits you make will
        apply to future feed posts.
      </p>
      <form
        className="feed-instructions-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="feed-instructions">What should your feed cover?</label>
        <textarea
          id="feed-instructions"
          autoFocus
          rows={7}
          maxLength={4000}
          value={draft}
          disabled={busy || !client.signedIn()}
          placeholder="Add instructions…"
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <div className="feed-error" role="alert">
            {error}
            <button type="button" disabled={busy} onClick={() => void review()}>
              Review cloud version
            </button>
          </div>
        )}
        {remote && (
          <aside className="feed-cloud-copy">
            <h3>Latest cloud version</h3>
            <p>{remote.content}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(remote.content);
                setBaseline(remote);
                setRemote(undefined);
                setError("");
              }}
            >
              Replace draft with this version
            </button>
            <p className="subtle">
              Your draft stays unchanged until you choose to replace it.
            </p>
          </aside>
        )}
        <footer>
          <button
            type="button"
            className="pill-button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="pill-button primary"
            disabled={busy || !dirty || !draft.trim() || !client.signedIn()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </form>
      {confirmClose && (
        <Modal title="Discard changes?" onClose={() => setConfirmClose(false)}>
          <p>Your feed instructions have unsaved changes.</p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              onClick={() => setConfirmClose(false)}
            >
              Keep editing
            </button>
            <button className="pill-button" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
