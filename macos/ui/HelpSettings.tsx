import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { t } from "../../shared/i18n";
import { shortcuts } from "./Shortcuts";
import { readShortcut, shortcutAvailable, shortcutLabel } from "./shortcut";
import { diagnosticReport } from "./diagnostics";
import { reportAvailable } from "./report";

// What this app can show about itself: its shortcuts and where its features
// live. Report a problem opens the report form in the main window, which
// makes a GitHub issue the person posts; without the Mac shell it copies a
// summary of the app's setup instead.
export function HelpSettings({ signedIn = false }: { signedIn?: boolean }) {
  const [quick, setQuick] = useState("⌥Space");
  const [copied, setCopied] = useState("");
  // WebKit lets the page write the clipboard only during the click, while
  // the report takes a moment to gather, so the clipboard is handed an item
  // whose text arrives when it is ready.
  const copyDiagnostics = () => {
    const report = diagnosticReport({ signedIn });
    const write =
      typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
        ? navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": report.then(
                (text) => new Blob([text], { type: "text/plain" }),
              ),
            }),
          ])
        : report.then((text) => navigator.clipboard.writeText(text));
    void write
      .then(() => setCopied(t("Copied. Paste it into your report.")))
      .catch(() => setCopied(t("Could not copy the diagnostics.")));
  };
  const report = () => {
    if (!reportAvailable()) return copyDiagnostics();
    (
      window as unknown as {
        webkit: {
          messageHandlers: {
            museWindow: { postMessage: (body: object) => void };
          };
        };
      }
    ).webkit.messageHandlers.museWindow.postMessage({ name: "report" });
  };
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
          aria-label={
            reportAvailable()
              ? t("Report a problem")
              : t("Report a problem: copy diagnostics")
          }
          onClick={report}
        >
          <span>{t("Report a problem")}</span>
          <Bug size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-footnote" role="status">
        {copied ||
          (reportAvailable()
            ? t(
                "Opens a new issue on GitHub with your description, a screenshot of the window and the app and macOS versions, language and the state of each permission and switch, without keys, messages or files.",
              )
            : t(
                "Copies the app and macOS versions, language and the state of each permission and switch, without keys, messages or files, for you to paste into a report.",
              ))}
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
    </>
  );
}
