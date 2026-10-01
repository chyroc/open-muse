import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import {
  readShortcut,
  recordShortcut,
  resetShortcut,
  saveShortcut,
  shortcutAvailable,
  shortcutLabel,
  shortcutSet,
  type Shortcut,
  type ShortcutId,
} from "./shortcut";

// One global shortcut: press the field, then the new keys. Quick Chat can go
// back to its default; an optional shortcut can be removed again.
export function ShortcutRow({
  id,
  title,
  detail,
  label,
  optional = false,
}: {
  id: ShortcutId;
  title: string;
  detail: string;
  label: string;
  optional?: boolean;
}) {
  const [shortcut, setShortcut] = useState<Shortcut>();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const available = shortcutAvailable();
  useEffect(() => {
    if (!available) return;
    void readShortcut(id)
      .then((value) => value && setShortcut(value))
      .catch(() => setError(t("Could not read the app settings.")));
  }, [available, id]);
  if (!available) return null;
  const apply = (request: Promise<Shortcut | undefined>) => {
    setError("");
    void request
      .then((value) => value && setShortcut(value))
      .catch((failure: Error) =>
        setError(failure.message || t("Could not change the app settings.")),
      )
      .finally(() => setRecording(false));
  };
  const set = shortcutSet(shortcut);
  const isDefault = optional
    ? !set
    : shortcut?.code === 49 && shortcut.modifiers === 2048;
  return (
    <>
      <div className="settings-row settings-shortcut-row">
        <div>
          <strong>{title}</strong>
          <p>
            {set && !shortcut!.registered
              ? t(
                  "macOS did not accept this shortcut for Open Muse. Choose another one.",
                )
              : detail}
          </p>
          {error && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          className={`shortcut-field ${recording ? "recording" : ""}`}
          aria-label={label}
          disabled={!shortcut}
          onClick={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (!recording) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") return setRecording(false);
            const next = recordShortcut(event.nativeEvent);
            if (next) apply(saveShortcut(next.code, next.modifiers, id));
          }}
        >
          {recording
            ? t("Type a shortcut…")
            : set
              ? shortcutLabel(shortcut!)
              : shortcut
                ? t("Record shortcut")
                : ""}
        </button>
        {shortcut && !isDefault && !recording && (
          <button
            className="settings-inline-button"
            onClick={() => apply(resetShortcut(id))}
          >
            {optional ? t("Remove") : t("Reset")}
          </button>
        )}
      </div>
    </>
  );
}

// The Quick Chat shortcut in General.
export function ShortcutSettings() {
  if (!shortcutAvailable()) return null;
  return (
    <div className="settings-group">
      <ShortcutRow
        id="quickChat"
        title={t("Quick chat")}
        detail={t(
          "Opens a small chat card over any app. Another app using the same keys may receive them first.",
        )}
        label={t("Change the Quick chat shortcut")}
      />
    </div>
  );
}
