import { useCallback, useEffect, useState } from "react";
import { systemLanguage, t } from "../../shared/i18n";
import { Switch } from "./SettingsSwitch";
import { ShortcutRow } from "./ShortcutSettings";
import { shortcutAvailable } from "./shortcut";
import {
  chooseInputDevice,
  dictationAvailable,
  dictationPreferences,
  saveDictationPreferences,
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
  const [preferences, setPreferences] = useState(dictationPreferences);
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
      <h2>{t("During dictation")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Microphone")}</strong>
            <p>{t("Dictation listens to this microphone.")}</p>
          </div>
          <select
            className="settings-select"
            aria-label={t("Microphone")}
            disabled={!state || state.running}
            value={
              state?.devices.some((device) => device.id === state.device)
                ? state.device
                : ""
            }
            onChange={(event) =>
              void chooseInputDevice(language, event.target.value)
                .then((value) => value && setState(value))
                .catch(() => setError(t("Could not change the app settings.")))
            }
          >
            <option value="">{t("System default")}</option>
            {state?.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
        <Switch
          label={t("Automatically send")}
          detail={t("Open Muse sends your message when you finish dictating.")}
          checked={preferences.autoSend}
          disabled={false}
          onChange={(autoSend) =>
            setPreferences(
              saveDictationPreferences({ ...preferences, autoSend }),
            )
          }
        />
        <Switch
          label={t("Play audio cues")}
          detail={t("A sound plays when dictation starts and stops.")}
          checked={preferences.cues}
          disabled={false}
          onChange={(cues) =>
            setPreferences(saveDictationPreferences({ ...preferences, cues }))
          }
        />
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
      </div>
      {shortcutAvailable() && (
        <>
          <h2>{t("Shortcuts")}</h2>
          <div className="settings-group">
            <ShortcutRow
              id="dictationHold"
              optional
              title={t("Push to talk")}
              detail={t(
                "Hold the shortcut in any app to dictate into Quick chat, and let go to stop.",
              )}
              label={t("Change the Push to talk shortcut")}
            />
            <ShortcutRow
              id="dictationToggle"
              optional
              title={t("Hands-free mode")}
              detail={t(
                "Press the shortcut to start dictating into Quick chat without holding, and press it again to stop.",
              )}
              label={t("Change the Hands-free mode shortcut")}
            />
          </div>
        </>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
