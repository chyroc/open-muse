import {
  ArrowUp,
  CheckCheck,
  ChevronDown,
  Circle,
  Code2,
  Compass,
  Feather,
  FileText,
  LoaderCircle,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentEvent, Category } from "../shared/types";
import { eventText } from "../shared/types";
import { categories } from "./content";
export { PermissionCard } from "./PermissionCard";

export function MuseMark({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? "muse-mark large" : "muse-mark"}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 53V31c0-19 25-19 25 0v22M39 31c0-19 25-19 25 0v22"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M67 12v8m-4-4h8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function CategoryIcon({
  category,
  size = 20,
}: {
  category: Category;
  size?: number;
}) {
  const Icon = {
    general: Circle,
    research: Search,
    writing: Feather,
    life: Compass,
    code: Code2,
  }[category];
  return <Icon size={size} strokeWidth={1.6} />;
}
export function Artwork({ type }: { type: string }) {
  return (
    <div className={`art art-${type}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      {type === "paper" || type === "mail" ? (
        <Feather size={48} strokeWidth={1} />
      ) : type === "code" ? (
        <Code2 size={54} strokeWidth={1} />
      ) : type === "book" ? (
        <FileText size={48} strokeWidth={1} />
      ) : null}
    </div>
  );
}
export function Composer({
  value,
  setValue,
  onSend,
  busy,
  running,
  onStop,
  category,
  setCategory,
  compact,
  disabled,
}: {
  value: string;
  setValue: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  running?: boolean;
  onStop?: () => void;
  category: Category;
  setCategory?: (value: Category) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && !disabled && value.trim() && !running) onSend();
  };
  return (
    <form className={`composer ${compact ? "compact" : ""}`} onSubmit={submit}>
      <textarea
        aria-label={compact ? "继续对话" : "描述你的任务"}
        placeholder={
          compact ? "补充一个想法，或者继续聊聊…" : "有什么事，想交给 Muse？"
        }
        value={value}
        maxLength={16000}
        onChange={(event) => setValue(event.target.value)}
        rows={compact ? 2 : 3}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (!busy && !disabled && !running && value.trim()) onSend();
          }
        }}
      />
      <div className="composer-tools">
        <div className="composer-left">
          {setCategory ? (
            <label className="category-select">
              <CategoryIcon category={category} size={15} />
              <select
                aria-label="任务类型"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as Category)
                }
              >
                {Object.entries(categories).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
          ) : (
            <span className="composer-hint">
              <ShieldCheck size={14} />
              工具按云端权限直接执行
            </span>
          )}
        </div>
        <div className="composer-right">
          <span className="keyboard-hint">⌘ ↵</span>
          {running && onStop ? (
            <button
              className="send-button stop"
              type="button"
              aria-label="停止任务"
              disabled={busy}
              onClick={onStop}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Square size={15} fill="currentColor" />
              )}
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              aria-label="发送任务"
              disabled={busy || disabled || !value.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <ArrowUp size={22} />
              )}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, src }) => (
            <a
              href={typeof src === "string" ? src : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看图片：{alt || "图片"}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function Activity({
  events,
  running,
}: {
  events: AgentEvent[];
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const actions = events.filter(
    (event) => !["agent.message", "user.message"].includes(event.type),
  );
  const names: Record<string, string> = {
    "agent.thinking": "正在思考与规划",
    "session.status_running": "开始执行",
    "session.status_idle": "本轮执行结束",
    "session.status_rescheduled": "等待重新调度",
    "session.status_terminated": "会话已终止",
    "user.interrupt": "已请求停止",
    "user.tool_confirmation": "已提交操作确认",
    "agent.tool_result": "工具返回结果",
    "agent.mcp_tool_result": "工具返回结果",
    "session.error": "执行异常",
  };
  if (!actions.length) return null;
  return (
    <section className="activity">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="activity-toggle"
      >
        {running ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <CheckCheck size={16} />
        )}
        <span>{running ? "Muse 正在处理" : "查看执行记录"}</span>
        <small>{actions.length} 条事件</small>
        <ChevronDown size={16} className={expanded ? "rotated" : ""} />
      </button>
      {expanded && (
        <ol>
          {actions.map((event) => (
            <li key={event.id}>
              <span className="timeline-dot" />
              <div>
                <strong>
                  {event.approval_source === "automatic"
                    ? "已自动批准网页工具"
                    : event.name
                      ? `调用 ${event.name}`
                      : (names[event.type] ?? event.type)}
                </strong>
                <time>
                  {formatTime(event.processed_at ?? event.created_at)}
                </time>
                {event.error?.message && (
                  <p className="error-text">{event.error.message}</p>
                )}
                {event.input != null && (
                  <pre>{JSON.stringify(event.input, null, 2)}</pre>
                )}
                {eventText(event) && <p>{eventText(event)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
export function formatTime(time?: string) {
  return time && !Number.isNaN(Date.parse(time))
    ? new Date(time).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
export function dateLabel(time: string) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? `今天 ${formatTime(time)}`
    : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
