import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { t } from "../../shared/i18n";
import { shortcuts } from "./Shortcuts";
import { readShortcut, shortcutAvailable, shortcutLabel } from "./shortcut";
import { diagnosticReport } from "./diagnostics";

// What this app can show about itself: its shortcuts and where its features
// live. There is no support channel, so nothing here sends a report; the
// person can copy a summary of the app's setup into one of their own.
export function HelpSettings({ signedIn = false }: { signedIn?: boolean }) {
  const [quick, setQuick] = useState("⌥Space");
  const [copied, setCopied] = useState("");
  const copyDiagnostics = () =>
    void diagnosticReport({ signedIn })
      .then((text) => navigator.clipboard.writeText(text))
      .then(() => setCopied(t("Copied. Paste it into your report.")))
      .catch(() => setCopied(t("Could not copy the diagnostics.")));
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
      <div className="settings-group">
        <button
          className="settings-row settings-nav-row"
          aria-label={t("Report a problem: copy diagnostics")}
          onClick={copyDiagnostics}
        >
          <span>{t("Report a problem")}</span>
          <Bug size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-footnote" role="status">
        {copied ||
          t(
            "Copies the app and macOS versions, language and the state of each permission and switch, without keys, messages or files, for you to paste into a report.",
          )}
      </p>
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
      <p className="settings-footnote">
        {t(
          "Open Muse is a personal client without a support channel. The project's README describes how each part works.",
        )}
      </p>
    </>
  );
}
