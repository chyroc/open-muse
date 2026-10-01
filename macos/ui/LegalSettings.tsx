import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { t } from "../../shared/i18n";

// The notices for the open-source software this app ships, read from the
// app bundle itself, and the terms that govern cloud use.
export function LegalSettings() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<string>();
  const [error, setError] = useState("");
  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || notices !== undefined) return;
    void fetch("notices.txt")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.text();
      })
      .then(setNotices)
      .catch(() =>
        setError(t("The notices are only included in the Mac app bundle.")),
      );
  }
  return (
    <>
      <p className="settings-lead">
        {t(
          "Open Muse runs no service of its own for chats; cloud use follows the agreement of the Ark account you connect. The software it ships includes open-source components under their own licenses.",
        )}
      </p>
      <div className="settings-group">
        <button
          className="settings-disclosure"
          aria-expanded={open}
          onClick={toggle}
        >
          <strong>{t("Open source notices")}</strong>
          <ChevronDown size={17} className={open ? "open" : ""} />
        </button>
      </div>
      {open && (
        <div className="settings-group settings-notices">
          {error ? (
            <p className="settings-error">{error}</p>
          ) : notices === undefined ? (
            <p>{t("Loading…")}</p>
          ) : (
            <pre>{notices}</pre>
          )}
        </div>
      )}
    </>
  );
}
