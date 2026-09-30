import { t } from "../shared/i18n";
import {
  Check,
  ChevronDown,
  Globe2,
  LoaderCircle,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import type { AgentEvent } from "../shared/types";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Only summarize known search parameters; unknown fields stay expanded by default, since a summary is not the full authorization scope.
export function searchPreview(event: AgentEvent) {
  if (event.name !== "web_search" || !object(event.input)) return null;
  const input = event.input;
  const requests = input.search_request_list;
  let queries: string[];
  let extra = false;
  if (
    Array.isArray(requests) &&
    requests.length &&
    requests.every(
      (item) =>
        object(item) && typeof item.query === "string" && item.query.trim(),
    )
  ) {
    queries = requests.map((item) => item.query as string);
    extra = requests.some((item) =>
      Object.keys(item).some((key) => key !== "query"),
    );
  } else if (
    typeof input.query === "string" &&
    input.query.trim() &&
    requests === undefined
  ) {
    queries = [input.query];
  } else return null;
  const queryKey = requests === undefined ? "query" : "search_request_list";
  extra ||= Object.keys(input).some(
    (key) => key !== queryKey && key !== "max_results",
  );
  const maxResults =
    typeof input.max_results === "number" &&
    Number.isSafeInteger(input.max_results) &&
    input.max_results > 0
      ? input.max_results
      : undefined;
  extra ||= input.max_results !== undefined && maxResults === undefined;
  return { queries, maxResults, extra };
}

export function PermissionCard({
  event,
  busy,
  onConfirm,
}: {
  event: AgentEvent;
  busy: boolean;
  onConfirm: (result: "allow" | "deny", event: AgentEvent) => void;
}) {
  const id = useId();
  const [decision, setDecision] = useState<"allow" | "deny">();
  const preview = searchPreview(event);
  const Icon = preview ? Globe2 : Wrench;
  const choose = (result: "allow" | "deny") => {
    if (busy) return;
    setDecision(result);
    onConfirm(result, event);
  };
  const queryList = (queries: string[], offset = 0) => (
    <ol className="permission-queries" start={offset + 1}>
      {queries.map((query, index) => (
        <li key={offset + index}>
          <span aria-hidden="true">
            {String(offset + index + 1).padStart(2, "0")}
          </span>
          <span>{query}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <section
      className="permission-card"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <header className="permission-heading">
        <span className="permission-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="permission-heading-copy">
          <h3 id={`${id}-title`}>
            {preview ? t("Allow web search?") : t("Allow this tool to run?")}
          </h3>
          <code>{event.name || t("Unnamed tool")}</code>
        </div>
        <span className="permission-status" role="status">
          {busy ? t("Submitting") : t("Pending approval")}
        </span>
      </header>
      <p className="permission-description">
        {preview
          ? t(
              "The following search queries will be sent to the search service to find information on the web.",
            )
          : t(
              "Please review the full parameters and their impact. Muse will only continue after you confirm.",
            )}
      </p>
      {preview && (
        <div className="permission-search">
          <div className="permission-search-label">
            <span>
              {t("Searching")}{" "}
              <b>{t("{count} items", { count: preview.queries.length })}</b>
            </span>
            {preview.maxResults !== undefined && (
              <span>
                {t("Max results")} {preview.maxResults}
              </span>
            )}
          </div>
          {queryList(preview.queries.slice(0, 3))}
          {preview.queries.length > 3 && (
            <details className="permission-more">
              <summary>
                {t("View the other {count} searches", {
                  count: preview.queries.length - 3,
                })}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              {queryList(preview.queries.slice(3), 3)}
            </details>
          )}
        </div>
      )}
      <details className="permission-details" open={!preview || preview.extra}>
        <summary>
          <ChevronDown size={14} aria-hidden="true" />
          <span>
            {preview?.extra
              ? t(
                  "Full parameters · includes additional options, please review",
                )
              : t("View full parameters")}
          </span>
          <span className="permission-format">JSON</span>
        </summary>
        <pre tabIndex={0} aria-label={t("Full tool parameters")}>
          {JSON.stringify(event.input ?? {}, null, 2)}
        </pre>
      </details>
      <footer className="permission-footer">
        <span className="permission-scope">
          <ShieldCheck size={14} aria-hidden="true" />
          {t("Authorize this call only")}
        </span>
        <div className="permission-actions">
          <button
            type="button"
            className="button subtle"
            disabled={busy}
            onClick={() => choose("deny")}
          >
            {busy && decision === "deny" ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <X size={16} aria-hidden="true" />
            )}
            {busy && decision === "deny" ? t("Denying…") : t("Deny")}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => choose("allow")}
          >
            {busy && decision === "allow" ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {busy && decision === "allow" ? t("Allowing…") : t("Approve")}
          </button>
        </div>
      </footer>
    </section>
  );
}
