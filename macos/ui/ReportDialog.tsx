import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { Modal } from "./Chrome";
import { diagnosticReport } from "./diagnostics";
import { discardSnapshot, issueLink, submitReport } from "./report";

// Report a problem: what happened, a picture of the window, and the app's
// setup, opened as a new issue on GitHub. Nothing is sent from here; the
// person posts the issue on GitHub, where the picture is pasted in.
export function ReportDialog({
  picture,
  signedIn,
  onClose,
  onOpened,
}: {
  picture?: string;
  signedIn: boolean;
  onClose: () => void;
  onOpened: (pasted: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [keep, setKeep] = useState(Boolean(picture));
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void diagnosticReport({ signedIn })
      .then(setDetails)
      .catch(() => setDetails(""));
  }, [signedIn]);
  const close = () => {
    discardSnapshot();
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    const withPicture = keep && Boolean(picture);
    try {
      const opened = await submitReport(
        issueLink({
          description: text,
          diagnostics: details,
          picture: withPicture,
        }),
        withPicture,
      );
      if (!opened) throw new Error();
      onOpened(withPicture);
    } catch {
      setError(t("Could not open GitHub. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("Report a problem")}
      className="report-dialog"
      onClose={close}
    >
      <p className="report-lead">
        {t(
          "Submitting opens a new issue on GitHub with what you write here and the details below. Nothing is posted until you submit it there.",
        )}
      </p>
      <textarea
        className="report-text"
        aria-label={t("What happened?")}
        placeholder={t("What happened, and what did you expect?")}
        value={text}
        autoFocus
        maxLength={4000}
        onChange={(event) => setText(event.target.value)}
      />
      {picture && (
        <label className="report-picture">
          <input
            type="checkbox"
            checked={keep}
            onChange={(event) => setKeep(event.target.checked)}
          />
          <img src={picture} alt={t("Screenshot of this window")} />
          <span>
            <strong>{t("Include a screenshot of this window")}</strong>
            <small>
              {t(
                "It goes to your clipboard; paste it into the issue with ⌘V. Leave it out if it shows anything private.",
              )}
            </small>
          </span>
        </label>
      )}
      <details className="report-details">
        <summary>{t("Details included")}</summary>
        <pre>{details}</pre>
      </details>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      <div className="report-actions">
        <button type="button" className="pill-button" onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="pill-button primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t("Open on GitHub")}
        </button>
      </div>
    </Modal>
  );
}
