import { useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { operations, groups, exampleFor, operationLabel } from "../shared/ma";
import type { Client } from "./api";
import type { AppConfig } from "../shared/types";
import { skillCandidates } from "./skill-candidates";
import { WorkspacePanel } from "./WorkspacePanel";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const parse = (value: string) => {
  const parsed = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("请输入 JSON 对象。");
  return parsed;
};
export function Studio({
  client,
  config,
}: {
  client: Client;
  config?: AppConfig;
}) {
  const [group, setGroup] = useState("agents");
  const [operation, setOperation] = useState("ListAgents");
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState("{}");
  const [query, setQuery] = useState("{}");
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const currentGroup = groups.find((g) => g.id === group)!;
  const choices = operations.filter(
    (o) =>
      currentGroup.match.test(o.id) &&
      (group !== "agents" || !/Session/.test(o.id)),
  );
  const op = operations.find((o) => o.id === operation)!;
  const mutation = op.method !== "GET" && !op.id.startsWith("List");
  const paths = op.fields.filter((f) => f.in === "path");
  const target = paths.map((f) => params[f.name] ?? "").join("/");
  const rows =
    result && typeof result === "object"
      ? ((result as Record<string, unknown>).data ??
        (result as Record<string, unknown>).Items ??
        (result as Record<string, unknown>).Data)
      : undefined;
  const nextPage =
    result && typeof result === "object"
      ? ((result as Record<string, unknown>).next_page ??
        (result as Record<string, unknown>).NextPage)
      : undefined;
  const linkResult =
    result && typeof result === "object"
      ? ((result as Record<string, unknown>).download_url ??
        (result as Record<string, unknown>).RedirectUrl)
      : undefined;
  const safeResultLink =
    typeof linkResult === "string" && linkResult.startsWith("https://")
      ? linkResult
      : undefined;
  const isReady = config?.mode === "ark";
  function choose(id: string, values: Record<string, string> = {}) {
    setOperation(id);
    setParams(values);
    setBody(pretty(exampleFor(id)));
    setQuery("{}");
    setResult(undefined);
    setError("");
    setConfirm(false);
    setDeleteText("");
    setFile(undefined);
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute(next?: string) {
    const bodyData = parse(body);
    const queryData = parse(query);
    if (next) {
      if (op.transport === "top") {
        bodyData[
          op.fields.some((f) => f.name === "PageToken") ? "PageToken" : "Page"
        ] = next;
        setBody(pretty(bodyData));
      } else {
        queryData.page = next;
        setQuery(pretty(queryData));
      }
    }
    let upload;
    if (file) {
      if (file.size > 10 * 1024 * 1024) throw new Error("文件最大为 10 MB。");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("读取文件失败。"));
        reader.readAsDataURL(file);
      });
      upload = { name: file.name, base64 };
    }
    setResult(
      await client.ma(operation, {
        params,
        body: bodyData,
        query: queryData,
        confirm,
        file: upload,
      }),
    );
    setConfirm(false);
  }
  function viewRow(row: Record<string, unknown>) {
    const id = String(row.id ?? row.Id ?? "");
    const get = choices.find(
      (o) =>
        o.id ===
        (operation === "ListMemories"
          ? "GetMemory"
          : operation === "ListCredentials"
            ? "GetCredential"
            : {
                agents: "GetAgent",
                environments: "GetEnvironment",
                sessions: "GetSession",
                memory: "GetMemoryStore",
                vaults: "GetVault",
                skills: "GetSkill",
                files: "GetFile",
              }[group]),
    );
    if (!get || !id) return;
    const field = get.fields.filter((f) => f.in === "path").at(-1)!;
    choose(get.id, { ...params, [field.name]: id });
  }
  return (
    <div className="page-content studio-page page-in">
      <div className="page-title">
        <span className="eyebrow">YOUR AGENT WORKSPACE</span>
        <h1>能力，随你组合。</h1>
        <p>助手与运行环境自动准备，连接更多工具，让想法变成行动。</p>
      </div>
      <div className="studio-status">
        <ShieldCheck size={18} />
        <span>
          {isReady
            ? "真实方舟连接 · 云端操作可能计费"
            : "演示模式 · 可查看接口，执行前请在设置中完成 SSO 登录"}
        </span>
        <a href="#/settings">
          连接设置 <ArrowRight size={14} />
        </a>
      </div>
      <WorkspacePanel client={client} />
      <details className="advanced-workbench">
        <summary>
          高级 MA 管理 <span>接口调试、资源与技能；日常使用无需配置</span>
        </summary>
        <div className="studio-tabs" role="tablist" aria-label="MA 资源类型">
          {groups.map((g) => (
            <button
              role="tab"
              aria-selected={g.id === group}
              key={g.id}
              onClick={() => {
                setGroup(g.id);
                choose(
                  operations.find(
                    (o) => g.match.test(o.id) && o.id.startsWith("List"),
                  )?.id ?? (g.id === "files" ? "UploadFile" : "CreateSkill"),
                );
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="studio-heading">
          <div>
            <h2>{currentGroup.label}</h2>
            <p>{currentGroup.hint}</p>
          </div>
          <span className="small-badge">{choices.length} 项接口</span>
        </div>
        {group === "skills" && (
          <div className="skills-assessment">
            <h3>MuseAI Skills · 适用性笔记</h3>
            <p>
              以下为能力评估，不表示技能已经安装。使用第三方技能前，需要核对许可、运行依赖和账号授权。
            </p>
            <div className="skill-candidate-grid">
              {skillCandidates.map((skill) => (
                <a
                  key={skill.name}
                  href={skill.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={`skill-tag ${skill.level}`}>
                    {skill.status}
                  </span>
                  <h4>
                    {skill.name}
                    <ExternalLink size={13} />
                  </h4>
                  <p>{skill.note}</p>
                </a>
              ))}
            </div>
          </div>
        )}
        <section className="ma-console">
          <div className="operation-bar">
            <label className="field">
              操作
              <select
                value={operation}
                onChange={(e) => choose(e.target.value)}
              >
                {choices.map((o) => (
                  <option value={o.id} key={o.id}>
                    {operationLabel(o.id)} · {o.id}
                  </option>
                ))}
              </select>
            </label>
            <code>
              {op.transport === "top" ? "TOP" : op.method} {op.path}
            </code>
          </div>
          {operation === "StreamSessionEvents" ? (
            <p className="info-note">
              实时流在任务详情中自动连接并补拉历史。先在会话列表选择会话，然后打开任务。
            </p>
          ) : (
            <>
              {paths.length > 0 && (
                <div className="path-fields">
                  {paths.map((f) => (
                    <label className="field" key={f.name}>
                      {f.name}
                      <input
                        value={params[f.name] ?? ""}
                        onChange={(e) => {
                          setParams({ ...params, [f.name]: e.target.value });
                          setConfirm(false);
                        }}
                        placeholder="资源 ID"
                      />
                    </label>
                  ))}
                </div>
              )}
              {op.fields.some((f) => ["body", "form"].includes(f.in)) && (
                <label className="field">
                  请求内容 · JSON
                  <textarea
                    className="json-editor"
                    spellCheck={false}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      setConfirm(false);
                    }}
                    rows={Math.min(16, Math.max(4, body.split("\n").length))}
                  />
                  <small>
                    嵌套配置、MCP、工具权限、skills 与 multiagent
                    均可在此设置；省略字段会保留现值。
                  </small>
                </label>
              )}
              {["UploadFile", "CreateSkill"].includes(operation) && (
                <label className="field file-picker">
                  <FolderOpen size={18} />
                  {operation === "CreateSkill"
                    ? "技能 ZIP（根目录需含 SKILL.md）"
                    : "选择上传文件"}
                  <input
                    key={operation}
                    type="file"
                    accept={operation === "CreateSkill" ? ".zip" : undefined}
                    onChange={(e) => {
                      setFile(e.target.files?.[0]);
                      setConfirm(false);
                    }}
                  />
                  <small>最多 10 MB。上传到方舟，不在本机执行。</small>
                </label>
              )}
              {op.fields.some((f) => f.in === "query") && (
                <details className="query-options">
                  <summary>筛选与分页参数</summary>
                  <label className="field">
                    Query JSON
                    <textarea
                      className="json-editor"
                      rows={3}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                </details>
              )}
              <details className="contract-fields">
                <summary>查看接口字段</summary>
                <div className="contract-table">
                  {op.fields.map((f) => (
                    <div key={f.in + f.name}>
                      <code>{f.name}</code>
                      <span>
                        {f.in} · {f.type}
                      </span>
                      <span>{f.required ? "必填" : "可选"}</span>
                    </div>
                  ))}
                </div>
              </details>
              {mutation && (
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  <span>
                    {op.method === "DELETE"
                      ? `确认删除 ${target || "指定资源"}。删除可能同时移除关联数据，且无法通过本应用恢复。`
                      : "确认向方舟提交以上内容，修改云端资源或触发执行。不会自动重试。"}
                  </span>
                </label>
              )}
              {op.method === "DELETE" && (
                <label className="field">
                  输入目标 ID 以确认
                  <input
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                    placeholder={target}
                  />
                </label>
              )}
              <button
                className={`button ${op.method === "DELETE" ? "danger" : "primary"}`}
                disabled={
                  busy ||
                  !isReady ||
                  (mutation && !confirm) ||
                  (op.method === "DELETE" && deleteText !== target)
                }
                onClick={() => void run(() => execute())}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {operationLabel(operation)}
              </button>
            </>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error} 写操作结果不明时，请先查询资源，避免重复提交。
            </p>
          )}
        </section>
        {result !== undefined && (
          <section className="ma-result">
            <div className="studio-heading">
              <h3>请求结果</h3>
              <span className="small-badge">方舟 API 响应</span>
            </div>
            {Array.isArray(rows) && (
              <div className="resource-list">
                {rows.length === 0 ? (
                  <p>没有符合条件的资源。</p>
                ) : (
                  rows.map((item, index) => {
                    const row = item as Record<string, unknown>;
                    const id = String(row.id ?? row.Id ?? "");
                    return (
                      <div className="resource-row" key={id || index}>
                        <button
                          className="resource-open"
                          onClick={() => viewRow(row)}
                        >
                          <strong>
                            {String(
                              row.name ??
                                row.title ??
                                row.display_name ??
                                row.path ??
                                row.Name ??
                                id,
                            )}
                          </strong>
                          <small>{id}</small>
                        </button>
                        {group === "sessions" && id && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await client.ma("GetSession", {
                                  params: { session_id: id },
                                });
                                location.hash = `/task/${encodeURIComponent(id)}`;
                              })
                            }
                          >
                            打开任务
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
            {Boolean(nextPage) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(() => execute(String(nextPage)))}
              >
                下一页
              </button>
            )}
            {safeResultLink && (
              <a
                className="button secondary"
                href={safeResultLink}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} />
                {operation === "GetFile" ? "打开文件下载链接" : "前往服务授权"}
              </a>
            )}
            <pre className="result-json">{pretty(result)}</pre>
          </section>
        )}
        <p className="studio-footnote">
          公开能力已按数据面接口接入；TOP 独有能力使用 SSO
          签名。内部管理接口不开放。上游未提供技能列表／删除、记忆历史版本等能力，本应用不伪造这些操作。
        </p>
      </details>
    </div>
  );
}
