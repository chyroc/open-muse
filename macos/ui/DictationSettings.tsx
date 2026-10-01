import { useCallback, useEffect, useState } from "react";
import { systemLanguage, t } from "../../shared/i18n";
import {
  dictationAvailable,
  openMicrophoneSettings,
  readDictation,
  requestDictation,
  type DictationState,
  type Permission,
} from "./dictation";

// What dictation needs from macOS and where speech is recognized.
export function DictationSettings() {
  const [state, setState] = useState<DictationState>();
  const [error, setError] = useState("");
  const available = dictationAvailable();
  const language = systemLanguage() === "zh-CN" ? "zh-CN" : "en-US";
  const refresh = useCallback(
    () =>
      void readDictation(language)
        .then((value) => value && setState(value))
        .catch(() => setError(t("Could not read the app settings."))),
    [language],
  );
  useEffect(() => {
    if (!available) return;
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [available, refresh]);
  const lead = (
    <p className="settings-lead">
      {t(
        "Press the microphone in the message field to dictate; text appears as you speak, and nothing is sent until you send it.",
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
              <p>{t("Dictation needs the Open Muse Mac app.")}</p>
            </div>
          </div>
        </div>
      </>
    );
  const row = (title: string, detail: string, permission?: Permission) => (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {permission === "allowed" ? (
        <span>{t("Allowed")}</span>
      ) : (
        <button
          className="settings-inline-button"
          disabled={!state}
          onClick={() =>
            void (
              permission === "not-asked"
                ? requestDictation(language)
                : openMicrophoneSettings()
            )
              .then((value) => value && setState(value))
              .catch(() => setError(t("Could not change the app settings.")))
          }
        >
          {permission === "not-asked" ? t("Allow") : t("Open System Settings")}
        </button>
      )}
    </div>
  );
  return (
    <>
      {lead}
      <h2>{t("macOS permissions")}</h2>
      <div className="settings-group">
        {row(
          t("Microphone"),
          t("Used only while you are dictating."),
          state?.microphone,
        )}
        {row(
          t("Speech recognition"),
          t("Turns what you say into text."),
          state?.speech,
        )}
      </div>
      <h2>{t("Where speech is recognized")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>
              {state?.onDevice
                ? t("On this Mac")
                : t("By Apple's speech service")}
            </strong>
            <p>
              {state?.onDevice
                ? t(
                    "Your language can be recognized on this Mac, so dictated audio does not leave it.",
                  )
                : t(
                    "Your language is not available on this Mac, so macOS sends dictated audio to Apple to recognize it.",
                  )}
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>{t("Dictation in other apps")}</strong>
            <p>
              {t(
                "Holding a key to dictate into any app is not built yet. Dictation works in the Open Muse message field.",
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
