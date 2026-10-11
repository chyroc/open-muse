import { useState } from "react";
import { t } from "../shared/i18n";
import { failureLines, recentFailures } from "../shared/diagnostic-log";
import {
  backgroundClient,
  type ProblemReport as Report,
} from "./background-client";
import { accountDevices } from "./devices";

// What a problem report sends: the platform, the app and system versions,
// and this device's recent failed requests, each already redacted. Values
// are trimmed to what the service accepts.
export function problemReport(
  platform: Report["platform"],
  version: string,
  system: string,
): Report {
  return {
    platform,
    app_version:
      version.replace(/[^0-9A-Za-z.+() -]/g, "").slice(0, 60) || "unknown",
    system: system.replace(/[^\w.,;:/() -]/g, "").slice(0, 160),
    failures: recentFailures(),
  };
}

// The same report as a person reads it before sending.
export function problemReportText(report: Report) {
  return [
    `Open Muse ${report.app_version} (${report.platform})`,
    report.system || "unknown system",
    ...(report.failures.length
      ? ["Recent failed requests:", ...failureLines(report.failures)]
      : ["Recent failed requests: none"]),
  ].join("\n");
}

// Offered next to an error: asks first, shows exactly what goes, and sends
// only when the person agrees. Nothing is sent on its own or retried. Shown
// only when an Open Muse account is signed in, since the account's service
// keeps the report.
export function ProblemReport({
  platform,
  version,
  system,
}: {
  platform: Report["platform"];
  version: string;
  system: string;
}) {
  const [stage, setStage] = useState<
    "idle" | "asking" | "sending" | "sent" | "failed"
  >("idle");
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState("");
  if (!accountDevices()) return null;
  const report = () => problemReport(platform, version, system);
  async function send() {
    setStage("sending");
    try {
      await backgroundClient.sendProblemReport(report());
      setStage("sent");
    } catch (error) {
      setFailure(
        (error as { code?: string }).code === "report_limit" ||
          /problem reports/.test((error as Error).message)
          ? (error as Error).message
          : t("The report could not be sent. Try again later."),
      );
      setStage("failed");
    }
  }
  if (stage === "idle")
    return (
      <button
        className="problem-report-open"
        onClick={() => setStage("asking")}
      >
        {t("Report this problem")}
      </button>
    );
  if (stage === "sent")
    return (
      <p className="problem-report-status" role="status">
        {t("Sent. Thank you.")}
      </p>
    );
  return (
    <div className="problem-report">
      <p>
        {stage === "failed"
          ? failure
          : t(
              "Send diagnostics about this problem to the developer? They include the app and system versions and the recent failed requests (which request, its status and error code), never your messages, keys, or account details.",
            )}
      </p>
      {shown && <pre>{problemReportText(report())}</pre>}
      <div className="problem-report-actions">
        <button
          className="problem-report-details"
          onClick={() => setShown(!shown)}
        >
          {shown ? t("Hide what is sent") : t("Show what is sent")}
        </button>
        <button onClick={() => setStage("idle")} disabled={stage === "sending"}>
          {t("Not now")}
        </button>
        <button
          className="problem-report-send"
          onClick={() => void send()}
          disabled={stage === "sending"}
        >
          {stage === "sending" ? t("Sending…") : t("Send report")}
        </button>
      </div>
    </div>
  );
}
