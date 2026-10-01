import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { shortcuts } from "./Shortcuts";
import { readShortcut, shortcutAvailable, shortcutLabel } from "./shortcut";

// What this app can show about itself: its shortcuts and where its features
// live. There is no support channel, so nothing here sends a report.
export function HelpSettings() {
  const [quick, setQuick] = useState("⌥Space");
  useEffect(() => {
    if (!shortcutAvailable()) return;
    void readShortcut()
      .then((value) => value && setQuick(shortcutLabel(value)))
      .catch(() => {});
  }, []);
  const tips = [
    [
      t("Quick chat"),
      t("Press {keys} over any app to open a small chat card.", {
        keys: quick,
      }),
    ],
    [t("Dictation"), t("Press the microphone in the message field and speak.")],
    [
      t("Computer use"),
      t(
        "Turn it on in Settings, then ask your assistant to do something on this Mac. Each action asks you first.",
      ),
    ],
  ];
  return (
    <>
      <h2>{t("Getting around")}</h2>
      <div className="settings-group">
        {tips.map(([title, detail]) => (
          <div className="settings-row" key={title}>
            <div>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          </div>
        ))}
      </div>
      <h2>{t("Keyboard shortcuts")}</h2>
      <div className="settings-group">
        {shortcuts.map(({ keys, label }) => (
          <div className="settings-row" key={keys}>
            <div>
              <strong>{t(label)}</strong>
            </div>
            <span>{keys}</span>
          </div>
        ))}
      </div>
      <p className="settings-lead settings-after">
        {t(
          "Open Muse is a personal client without a support channel. The project's README describes how each part works.",
        )}
      </p>
    </>
  );
}
