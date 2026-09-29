import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, LoaderCircle, LogOut } from "lucide-react";
import type { Client } from "./api";
import { nativeMobile, openAuthorization } from "./platform";
import { WorkspacePanel } from "./WorkspacePanel";

interface Status {
  loggedIn: boolean;
  ready: boolean;
  project?: string;
  apiKeyId?: string;
  method?: "sso" | "api_key";
}
export function AuthPanel({
  client,
  onChanged,
}: {
  client: Client;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [login, setLogin] = useState<{
    transaction: string;
    authorizeUrl: string;
  }>();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"sso" | "api_key">("sso");
  const [apiKey, setAPIKey] = useState("");
  const [keyProject, setKeyProject] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  async function statusAndProjects() {
    const result = await client.auth<Status>("status");
    setStatus(result);
    if (result.loggedIn && !result.ready) {
      const listed = await client.auth<{ projects: string[] }>("projects");
      setProjects(listed.projects);
      setProject(result.project ?? listed.projects[0] ?? "");
    }
  }
  useEffect(() => {
    void statusAndProjects().catch((e) => setError(e.message));
  }, [client]);
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="settings-card auth-card">
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <KeyRound size={21} />
        </div>
        <div>
          <h2>连接方舟 MA</h2>
          <p>连接方舟项目，自动准备你的个人助手</p>
        </div>
        <span className="small-badge">
          {status?.ready ? "已连接" : status?.loggedIn ? "选择项目" : "未登录"}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!status?.loggedIn && (
        <>
          <div className="auth-methods" role="group" aria-label="登录方式">
            <button
              type="button"
              aria-pressed={method === "sso"}
              disabled={busy}
              onClick={() => {
                setMethod("sso");
                setAPIKey("");
                setError("");
              }}
            >
              火山 SSO
            </button>
            <button
              type="button"
              aria-pressed={method === "api_key"}
              disabled={busy}
              onClick={() => {
                setMethod("api_key");
                setLogin(undefined);
                setCode("");
                setError("");
              }}
            >
              API Key
            </button>
          </div>
          {method === "api_key" ? (
            <form
              className="auth-steps"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  let result: { sessionToken: string };
                  try {
                    result = await client.auth("api-key", {
                      apiKey: apiKey.trim(),
                      project: keyProject.trim(),
                      confirm: true,
                    });
                  } finally {
                    setAPIKey("");
                  }
                  await client.setSSOToken(result.sessionToken);
                  await statusAndProjects();
                  onChanged();
                });
              }}
            >
              <label className="field">
                方舟 API Key
                <input
                  aria-label="方舟 API Key"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  maxLength={1024}
                  value={apiKey}
                  onChange={(event) => setAPIKey(event.target.value)}
                  placeholder="粘贴已有的方舟 API Key"
                />
              </label>
              <label className="field">
                项目名称（可选）
                <input
                  autoComplete="off"
                  autoCapitalize="none"
                  maxLength={128}
                  value={keyProject}
                  onChange={(event) => setKeyProject(event.target.value)}
                  placeholder="留空使用密钥所属项目"
                />
              </label>
              <p className="auth-consent-note">
                密钥仅提交给当前 Open Muse
                服务，加密保存后不回传。连接时验证密钥，首次使用时自动创建助手和运行环境，云端调用可能计费。需要
                STS 的控制面接口仍须 SSO 登录。
              </p>
              <button
                className="button primary"
                disabled={busy || !apiKey.trim()}
              >
                连接 API Key
              </button>
            </form>
          ) : (
            <>
              <p className="settings-description">
                在火山官网完成登录，把页面显示的授权码粘贴回来。STS、刷新令牌与
                API Key 只保存在服务端，不会发送到 App。
              </p>
              {!login ? (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setLogin(await client.auth("begin", {}));
                    })
                  }
                >
                  开始 SSO 登录
                </button>
              ) : (
                <div className="auth-steps">
                  <a
                    className="button primary"
                    href={login.authorizeUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (nativeMobile()) {
                        e.preventDefault();
                        void openAuthorization(login.authorizeUrl).catch((e) =>
                          setError(e.message),
                        );
                      }
                    }}
                  >
                    1. 前往火山授权 <ExternalLink size={16} />
                  </a>
                  <label className="field">
                    2. 粘贴授权码
                    <input
                      type="password"
                      autoComplete="off"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="授权码、编码回调或完整回调 URL"
                    />
                  </label>
                  <small>
                    授权链接有效期 10 分钟。不要把授权码发送给他人。
                  </small>
                  <button
                    className="button secondary"
                    disabled={busy || !code.trim()}
                    onClick={() =>
                      void run(async () => {
                        const result = await client.auth<{
                          sessionToken: string;
                        }>("complete", {
                          transaction: login.transaction,
                          code,
                        });
                        setCode("");
                        setLogin(undefined);
                        await client.setSSOToken(result.sessionToken);
                        await statusAndProjects();
                      })
                    }
                  >
                    验证授权码
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setLogin(undefined);
                      setCode("");
                    }}
                  >
                    重新开始
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {status?.loggedIn && !status.ready && (
        <div className="auth-steps">
          <label className="field project-field">
            项目
            <div className="project-select-wrap">
              <select
                aria-label="选择项目"
                disabled={busy || Boolean(status.apiKeyId)}
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </label>
          {!projects.length && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(statusAndProjects)}
            >
              重新读取项目
            </button>
          )}
          <p className="auth-consent-note">
            连接后，Muse 会在此项目创建专用密钥，并自动准备助手和云端运行环境。
            密钥可访问项目全部方舟资源，不限制来源
            IP；云端调用可能计费。云环境可访问公网，网页搜索与读取自动批准，其他工具仍需确认。
          </p>
          <button
            className="button primary"
            disabled={busy || !project}
            onClick={() =>
              void run(async () => {
                try {
                  await client.auth("project", { project, confirm: true });
                } finally {
                  await statusAndProjects();
                }
                onChanged();
              })
            }
          >
            {status.apiKeyId ? "继续连接" : "连接项目并开始使用"}
          </button>
        </div>
      )}
      {status?.ready && (
        <div className="auth-connected">
          <p>
            {status.method === "api_key" ? "API Key 已连接" : "SSO 已连接"} ·{" "}
            {status.project ? (
              <>
                项目 <strong>{status.project}</strong>
              </>
            ) : (
              "密钥所属项目"
            )}
          </p>
          <WorkspacePanel client={client} />
          {status.apiKeyId && (
            <details className="auth-key-details">
              <summary>密钥管理信息</summary>
              <p className="muted">API Key ID：{status.apiKeyId}</p>
            </details>
          )}
        </div>
      )}
      {(status?.loggedIn || client.ssoToken()) && (
        <div className="logout-row">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.auth("logout", {});
                await client.setSSOToken("");
                onChanged();
              })
            }
          >
            <LogOut size={15} />
            退出此登录
          </button>
          <small>
            退出会删除服务端登录凭据，但不会撤销云端 API
            Key。可在方舟控制台撤销。切换登录方式请先退出。
          </small>
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          <LoaderCircle className="spin" size={15} /> 正在处理，请勿重复提交…
        </p>
      )}
    </section>
  );
}
