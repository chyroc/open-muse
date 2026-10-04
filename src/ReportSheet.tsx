import { useRef, useState } from "react";
import { CirclePlus, X } from "lucide-react";
import { t } from "../shared/i18n";
import { buildCommit } from "./build-info";
import { shellVersion } from "./devices";
import { Sheet } from "./MusePages";
import { nativeMobile } from "./platform";
import { shellSystem } from "./DevicesSheet";
import { Share } from "@capacitor/share";
import "./report-sheet.css";

// The parts of the app a report can be about, as the person sees them.
export const reportAreas = [
  "Account and workspace",
  "Assistant status and activity",
  "Main chat",
  "Side chats",
  "Feed",
  "Ideas",
  "Goals",
  "Library",
  "Connectors",
  "Settings",
  "Other",
] as const;
export type ReportArea = (typeof reportAreas)[number];

const MAX_TEXT = 4000;
const MAX_ATTACHMENTS = 4;

// What a report says, with the app's version and the system it runs on so
// the problem can be reproduced. Nothing else about the person is included.
export function reportText(
  description: string,
  areas: readonly ReportArea[],
  system = shellSystem() ||
    (globalThis.navigator?.userAgent ?? "").slice(0, 160),
) {
  return [
    "Open Muse problem report",
    "",
    description.trim(),
    "",
    `Area: ${areas.length ? areas.join(", ") : "Not chosen"}`,
    `Version: ${buildCommit || "development build"}${shellVersion() ? ` (${shellVersion()})` : ""}`,
    `System: ${system || "unknown"}`,
  ].join("\n");
}

// Settings > Report a problem: what went wrong, screenshots, and which part
// of the app it is about. Open Muse has no support service of its own, so
// Submit hands the report to the system share sheet, where the person picks
// where it goes (Mail, Lark, or anywhere else); nothing is sent on its own.
export function ReportSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  // Picked screenshots, each with a preview URL released when removed.
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const files = shots.map((shot) => shot.file);
  const [areas, setAreas] = useState<ReportArea[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const toggle = (area: ReportArea) =>
    setAreas((current) =>
      current.includes(area)
        ? current.filter((item) => item !== area)
        : [...current, area],
    );
  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setStatus("");
    const report = reportText(text, areas);
    try {
      const data = { title: t("Open Muse problem report"), text: report };
      // Screenshots go with the report where the share sheet can take files.
      if (files.length && navigator.canShare?.({ files }))
        await navigator.share({ ...data, files });
      else if (nativeMobile()) await Share.share(data);
      else if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(report);
        setStatus(t("Report copied. Paste it wherever you want to send it."));
        return;
      }
      setStatus(t("Report handed to the app you chose."));
    } catch (reason) {
      // Closing the share sheet is not a failure.
      if ((reason as Error).name !== "AbortError")
        setStatus((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("Report a problem")} onClose={onClose} grouped>
      <div className="report-sheet">
        <label className="report-heading" htmlFor="report-text">
          {t("What went wrong?")}
        </label>
        <textarea
          id="report-text"
          className="report-text"
          value={text}
          maxLength={MAX_TEXT}
          placeholder={t(
            "Describe the problem, the steps to reproduce it, and what you expected instead.",
          )}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="report-count" aria-live="polite">
          {text.length}
        </p>
        <h3 className="report-heading">{t("Attachments")}</h3>
        <div className="report-attachments">
          {shots.map((shot) => (
            <figure key={shot.url} className="report-thumb">
              <img src={shot.url} alt="" />
              <button
                type="button"
                aria-label={t("Remove attachment")}
                onClick={() => {
                  URL.revokeObjectURL(shot.url);
                  setShots((current) =>
                    current.filter((item) => item !== shot),
                  );
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </figure>
          ))}
          {shots.length < MAX_ATTACHMENTS && (
            <button
              type="button"
              className="report-add"
              aria-label={t("Add attachment")}
              onClick={() => picker.current?.click()}
            >
              <CirclePlus size={26} aria-hidden="true" />
              <span>{t("Add")}</span>
            </button>
          )}
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])].filter((file) =>
                file.type.startsWith("image/"),
              );
              setShots((current) => [
                ...current,
                ...picked
                  .slice(0, MAX_ATTACHMENTS - current.length)
                  .map((file) => ({ file, url: URL.createObjectURL(file) })),
              ]);
              event.target.value = "";
            }}
          />
        </div>
        <h3 className="report-heading">{t("What is this about?")}</h3>
        <div className="report-areas" role="group">
          {reportAreas.map((area) => (
            <button
              key={area}
              type="button"
              className="report-area"
              aria-pressed={areas.includes(area)}
              onClick={() => toggle(area)}
            >
              {t(area)}
            </button>
          ))}
        </div>
        <p className="settings-footnote">
          {t(
            "Submit opens the share sheet so you choose where the report goes. It includes what you write and attach, the app version and the system version, and nothing else.",
          )}
        </p>
        {status && (
          <p className="settings-footnote" role="status">
            {status}
          </p>
        )}
        <button
          type="button"
          className="report-submit"
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
        >
          {t("Submit")}
        </button>
      </div>
    </Sheet>
  );
}
