import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import {
  readShortcut,
  recordShortcut,
  resetShortcut,
  saveShortcut,
  shortcutAvailable,
  shortcutLabel,
  type Shortcut,
} from "./shortcut";

// Records the Quick Chat shortcut: press the field, then the new keys.
export function ShortcutSettings() {
  const [shortcut, setShortcut] = useState<Shortcut>();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const available = shortcutAvailable();
  useEffect(() => {
    if (!available) return;
    void readShortcut()
      .then((value) => value && setShortcut(value))
      .catch(() => setError(t("Could not read the app settings.")));
  }, [available]);
  if (!available) return null;
  const apply = (request: Promise<Shortcut | undefined>) => {
    setError("");
    void request
      .then((value) => value && setShortcut(value))
      .catch(() => setError(t("Could not change the app settings.")))
      .finally(() => setRecording(false));
  };
  const isDefault = shortcut?.code === 49 && shortcut.modifiers === 2048;
  return (
    <>
      <div className="settings-group">
        <div className="settings-row settings-shortcut-row">
          <div>
            <strong>{t("Quick chat")}</strong>
            <p>
              {shortcut && !shortcut.registered
                ? t(
                    "macOS did not accept this shortcut for Open Muse. Choose another one.",
                  )
                : t(
                    "Opens a small chat card over any app. Another app using the same keys may receive them first.",
                  )}
            </p>
          </div>
          <button
            className={`shortcut-field ${recording ? "recording" : ""}`}
            aria-label={t("Change the Quick chat shortcut")}
            disabled={!shortcut}
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              if (!recording) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") return setRecording(false);
              const next = recordShortcut(event.nativeEvent);
              if (next) apply(saveShortcut(next.code, next.modifiers));
            }}
          >
            {recording
              ? t("Type a shortcut…")
              : shortcut
                ? shortcutLabel(shortcut)
                : ""}
          </button>
          {shortcut && !isDefault && !recording && (
            <button
              className="settings-inline-button"
              onClick={() => apply(resetShortcut())}
            >
              {t("Reset")}
            </button>
          )}
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
