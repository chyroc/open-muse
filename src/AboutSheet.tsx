import { useState } from "react";
import { ExternalLink, ShieldCheck, Unplug } from "lucide-react";
import { t } from "../shared/i18n";
import { buildCommit } from "./build-info";
import { MuseMark } from "./components";
import { Sheet } from "./MusePages";
import "./about-sheet.css";

// About, as iOS presents it in Settings: the app's icon and name, then grouped
// rows. The version is the commit the app was built from; tapping it copies it.
export function AboutSheet({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const version = buildCommit || t("Development build");
  return (
    <Sheet title={t("About")} onClose={onClose} grouped>
      <div className="about-hero">
        <span className="about-icon" aria-hidden="true">
          <MuseMark />
        </span>
        <h2>Open Muse</h2>
        <p>{t("Version {version}", { version })}</p>
      </div>
      <ul className="settings-list">
        <li>
          <button
            className="settings-list-row"
            disabled={!buildCommit}
            onClick={() =>
              void navigator.clipboard?.writeText(buildCommit).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            <span className="settings-row-text">{t("Version")}</span>
            <span className="settings-row-value about-version">
              {copied ? t("Copied") : version}
            </span>
          </button>
        </li>
        <li>
          <div className="settings-list-row">
            <span className="settings-row-text">{t("Runs on")}</span>
            <span className="settings-row-value">Volcano Ark MA</span>
          </div>
        </li>
        <li>
          <a
            className="settings-list-row"
            href="https://www.volcengine.com/product/ark"
            target="_blank"
            rel="noreferrer"
          >
            <span className="settings-row-text">
              {t("Volcano Ark website")}
            </span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </li>
      </ul>
      <ul className="settings-list about-notes">
        <li>
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>{t("Every step is visible")}</strong>
            <p>
              {t(
                "Tools run directly by default and may send data to external services, change files, or incur charges. Upstream denials still apply. Execution records stay in the conversation.",
              )}
            </p>
          </div>
        </li>
        <li>
          <Unplug size={20} aria-hidden="true" />
          <div>
            <strong>{t("A real connection")}</strong>
            <p>
              {t(
                "If sign-in expires or a request fails, Open Muse reports the error instead of generating simulated replies.",
              )}
            </p>
          </div>
        </li>
      </ul>
    </Sheet>
  );
}
