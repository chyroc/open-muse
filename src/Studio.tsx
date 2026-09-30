import { t } from "../shared/i18n";
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
    throw new Error(t("Please enter a JSON object."));
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
      o.transport !== "top" &&
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
      if (file.size > 10 * 1024 * 1024)
        throw new Error(t("The file can be at most 10 MB."));
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error(t("Couldn't read the file.")));
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
        <span className="eyebrow">{t("YOUR AGENT WORKSPACE")}</span>
        <h1>{t("Capabilities, your way.")}</h1>
        <p>
          {t(
            "The assistant and runtime are ready automatically; connect more tools and turn ideas into action.",
          )}
        </p>
      </div>
      <div className="studio-status">
        <ShieldCheck size={18} />
        <span>
          {isReady
            ? t("Live Ark connection · cloud operations may be billed")
            : t("Add an Ark API key in Settings to use Ark MA")}
        </span>
        <a href="#/settings">
          {t("Connection settings")} <ArrowRight size={14} />
        </a>
      </div>
      <WorkspacePanel client={client} />
      <details className="advanced-workbench">
        <summary>
          {t("Advanced MA management")}{" "}
          <span>
            {t(
              "API debugging, resources, and skills; not needed for daily use",
            )}
          </span>
        </summary>
        <div
          className="studio-tabs"
          role="tablist"
          aria-label={t("MA resource type")}
        >
          {groups.map((g) => (
            <button
              role="tab"
              aria-selected={g.id === group}
              key={g.id}
              onClick={() => {
                setGroup(g.id);
                choose(
                  operations.find(
                    (o) =>
                      o.transport !== "top" &&
                      g.match.test(o.id) &&
                      o.id.startsWith("List"),
                  )?.id ?? (g.id === "files" ? "UploadFile" : "CreateSkill"),
                );
              }}
            >
              {t(g.label)}
            </button>
          ))}
        </div>
        <div className="studio-heading">
          <div>
            <h2>{t(currentGroup.label)}</h2>
            <p>{t(currentGroup.hint)}</p>
          </div>
          <span className="small-badge">
            {t("{count} endpoints", { count: choices.length })}
          </span>
        </div>
        {group === "skills" && (
          <div className="skills-assessment">
            <h3>{t("MuseAI Skills · suitability notes")}</h3>
            <p>
              {t(
                "The items below are capability assessments and don't mean a skill is installed. Before using a third-party skill, verify its license, runtime dependencies, and account authorization.",
              )}
            </p>
            <div className="skill-candidate-grid">
              {skillCandidates.map((skill) => (
                <a
                  key={t(skill.name)}
                  href={skill.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={`skill-tag ${skill.level}`}>
                    {t(skill.status)}
                  </span>
                  <h4>
                    {t(skill.name)}
                    <ExternalLink size={13} />
                  </h4>
                  <p>{t(skill.note)}</p>
                </a>
              ))}
            </div>
          </div>
        )}
        <section className="ma-console">
          <div className="operation-bar">
            <label className="field">
              {t("Operation")}
              <select
                value={operation}
                onChange={(e) => choose(e.target.value)}
              >
                {choices.map((o) => (
                  <option value={o.id} key={o.id}>
                    {t(operationLabel(o.id))} · {o.id}
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
              {t(
                "The live stream connects automatically in the task view and backfills history. Pick a session from the list first, then open its task.",
              )}
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
                        placeholder={t("Resource ID")}
                      />
                    </label>
                  ))}
                </div>
              )}
              {op.fields.some((f) => ["body", "form"].includes(f.in)) && (
                <label className="field">
                  {t("Request body · JSON")}
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
                    {t(
                      "Nested config, MCP, tool permissions, skills, and multiagent can all be set here; omitted fields keep their current value.",
                    )}
                  </small>
                </label>
              )}
              {["UploadFile", "CreateSkill"].includes(operation) && (
                <label className="field file-picker">
                  <FolderOpen size={18} />
                  {operation === "CreateSkill"
                    ? t("Skill ZIP (the root folder must contain SKILL.md)")
                    : t("Choose a file to upload")}
                  <input
                    key={operation}
                    type="file"
                    accept={operation === "CreateSkill" ? ".zip" : undefined}
                    onChange={(e) => {
                      setFile(e.target.files?.[0]);
                      setConfirm(false);
                    }}
                  />
                  <small>
                    {t(
                      "Up to 10 MB. Uploaded to Ark; it does not run on this device.",
                    )}
                  </small>
                </label>
              )}
              {op.fields.some((f) => f.in === "query") && (
                <details className="query-options">
                  <summary>{t("Filter and pagination parameters")}</summary>
                  <label className="field">
                    {t("Query JSON")}
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
                <summary>{t("View endpoint fields")}</summary>
                <div className="contract-table">
                  {op.fields.map((f) => (
                    <div key={f.in + f.name}>
                      <code>{f.name}</code>
                      <span>
                        {f.in} · {f.type}
                      </span>
                      <span>{f.required ? t("Required") : t("Optional")}</span>
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
                      ? t(
                          "Confirm deletion of {target}. Deletion may also remove related data and cannot be undone from this app.",
                          { target: target || t("the specified resource") },
                        )
                      : t(
                          "Confirm submitting the above to Ark, which may change cloud resources or trigger execution. It will not be retried automatically.",
                        )}
                  </span>
                </label>
              )}
              {op.method === "DELETE" && (
                <label className="field">
                  {t("Enter the target ID to confirm")}
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
                {t(operationLabel(operation))}
              </button>
            </>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}{" "}
              {t(
                "If the result of a write is unclear, query the resource first to avoid submitting twice.",
              )}
            </p>
          )}
        </section>
        {result !== undefined && (
          <section className="ma-result">
            <div className="studio-heading">
              <h3>{t("Request result")}</h3>
              <span className="small-badge">{t("Ark API response")}</span>
            </div>
            {Array.isArray(rows) && (
              <div className="resource-list">
                {rows.length === 0 ? (
                  <p>{t("No resources match.")}</p>
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
                            {t("Open task")}
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
                {t("Next page")}
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
                {operation === "GetFile"
                  ? t("Open file download link")
                  : t("Go to service authorization")}
              </a>
            )}
            <pre className="result-json">{pretty(result)}</pre>
          </section>
        )}
        <p className="studio-footnote">
          {t(
            "Public capabilities are integrated via data-plane endpoints available to an Ark API key; console-only (TOP) actions are not offered. Internal management endpoints are not exposed. Upstream does not provide skill listing/deletion or memory history versions, so this app does not fake those operations.",
          )}
        </p>
      </details>
    </div>
  );
}
