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

// 只为已知的搜索参数提供摘要；未知字段仍默认展开，不能把摘要当成完整授权范围。
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
            {preview ? "允许搜索网页？" : "允许执行此工具？"}
          </h3>
          <code>{event.name || "未命名工具"}</code>
        </div>
        <span className="permission-status" role="status">
          {busy ? "正在提交" : "等待确认"}
        </span>
      </header>
      <p className="permission-description">
        {preview
          ? "以下搜索词将发送至搜索服务，用于查找网页信息。"
          : "请检查完整参数及操作影响，确认后 Muse 才会继续。"}
      </p>
      {preview && (
        <div className="permission-search">
          <div className="permission-search-label">
            <span>
              搜索内容 <b>{preview.queries.length} 项</b>
            </span>
            {preview.maxResults !== undefined && (
              <span>结果上限 {preview.maxResults}</span>
            )}
          </div>
          {queryList(preview.queries.slice(0, 3))}
          {preview.queries.length > 3 && (
            <details className="permission-more">
              <summary>
                查看其余 {preview.queries.length - 3} 项搜索
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
            {preview?.extra ? "完整参数 · 含额外选项，请检查" : "查看完整参数"}
          </span>
          <span className="permission-format">JSON</span>
        </summary>
        <pre tabIndex={0} aria-label="完整工具参数">
          {JSON.stringify(event.input ?? {}, null, 2)}
        </pre>
      </details>
      <footer className="permission-footer">
        <span className="permission-scope">
          <ShieldCheck size={14} aria-hidden="true" />
          仅授权本次调用
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
            {busy && decision === "deny" ? "正在拒绝…" : "拒绝"}
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
            {busy && decision === "allow" ? "正在允许…" : "允许这一次"}
          </button>
        </div>
      </footer>
    </section>
  );
}
