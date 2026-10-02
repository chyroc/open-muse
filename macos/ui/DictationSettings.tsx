import { useCallback, useEffect, useState } from "react";
import { systemLanguage, t } from "../../shared/i18n";
import { AudioLines, ChevronDown, Mic } from "lucide-react";
import { Switch } from "./SettingsSwitch";
import { PermissionRow } from "./ComputerSettings";
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
  if (!available)
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Not connected")}</strong>
            <p>{t("Dictation needs the Open Muse Mac app.")}</p>
          </div>
        </div>
      </div>
    );
  // Asks macOS the first time, and opens System Settings afterwards.
  const permission = (title: string, icon: typeof Mic, value?: Permission) => (
    <PermissionRow
      icon={icon}
      title={title}
      granted={value === "allowed"}
      disabled={!state}
      onOpen={() =>
        void (
          value === "not-asked"
            ? requestDictation(language)
            : openMicrophoneSettings()
        )
          .then((next) => next && setState(next))
          .catch(() => setError(t("Could not change the app settings.")))
      }
    />
  );
  // Everything below the permissions waits until macOS grants both.
  const ready = state?.microphone === "allowed" && state.speech === "allowed";
  return (
    <>
      <section>
        <h2>{t("Permissions required")}</h2>
        <div className="settings-group computer-permissions">
          {permission(t("Microphone"), Mic, state?.microphone)}
          {permission(t("Speech recognition"), AudioLines, state?.speech)}
        </div>
        <p className="settings-footnote">
          {t("Dictation enables Open Muse to turn speech to text.")}
        </p>
      </section>
      <div className="permission-settings-controls" data-disabled={!ready}>
        <div className="settings-group">
          <div className="settings-row settings-dropdown-row">
            <span className="settings-dropdown-label">{t("Input device")}</span>
            <span className="settings-dropdown">
              <select
                aria-label={t("Input device")}
                disabled={!state || state.running || !ready}
                value={
                  state?.devices.some((device) => device.id === state.device)
                    ? state.device
                    : ""
                }
                onChange={(event) =>
                  void chooseInputDevice(language, event.target.value)
                    .then((value) => value && setState(value))
                    .catch(() =>
                      setError(t("Could not change the app settings.")),
                    )
                }
              >
                <option value="">{t("System default")}</option>
                {state?.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </div>
        </div>
        <section>
          <h2>{t("During dictation")}</h2>
          <div className="settings-group">
            <Switch
              label={t("Automatically send")}
              detail={t(
                "Open Muse sends your message when you finish dictating.",
              )}
              checked={preferences.autoSend}
              disabled={!ready}
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
              disabled={!ready}
              onChange={(cues) =>
                setPreferences(
                  saveDictationPreferences({ ...preferences, cues }),
                )
              }
            />
          </div>
        </section>
        {shortcutAvailable() && (
          <section>
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
          </section>
        )}
        <section>
          <h2>{t("Where speech is recognized")}</h2>
          <p className="settings-footnote">
            {state?.onDevice
              ? t(
                  "Your language can be recognized on this Mac, so dictated audio does not leave it.",
                )
              : t(
                  "Your language is not available on this Mac, so macOS sends dictated audio to Apple to recognize it.",
                )}
          </p>
        </section>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
