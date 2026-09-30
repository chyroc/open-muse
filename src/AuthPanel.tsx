import { t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, LoaderCircle, LogOut } from "lucide-react";
import type { Client } from "./api";
import { nativeMobile, openAuthorization } from "./platform";
import { WorkspacePanel } from "./WorkspacePanel";
import { BackgroundSettings } from "./BackgroundSettings";

interface Status {
  loggedIn: boolean;
  ready: boolean;
  project?: string;
  apiKeyId?: string;
  method?: "sso" | "api_key";
}
function ArkAuthPanel({
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
          <h2>{t("Connect to Ark MA")}</h2>
          <p>
            {t(
              "Connect an Ark project and your personal assistant is set up automatically",
            )}
          </p>
        </div>
        <span className="small-badge">
          {status?.ready
            ? t("Connected")
            : status?.loggedIn
              ? t("Choose a project")
              : t("Not signed in")}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!status?.loggedIn && (
        <>
          <div
            className="auth-methods"
            role="group"
            aria-label={t("Sign-in method")}
          >
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
              Volcano SSO
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
                  try {
                    await client.auth("api-key", {
                      apiKey: apiKey.trim(),
                      project: keyProject.trim(),
                      confirm: true,
                    });
                  } finally {
                    setAPIKey("");
                  }
                  await statusAndProjects();
                  onChanged();
                });
              }}
            >
              <label className="field">
                Ark API Key
                <input
                  aria-label="Ark API Key"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  maxLength={1024}
                  value={apiKey}
                  onChange={(event) => setAPIKey(event.target.value)}
                  placeholder={t("Paste an existing Ark API Key")}
                />
              </label>
              <label className="field">
                {t("Project name (optional)")}
                <input
                  autoComplete="off"
                  autoCapitalize="none"
                  maxLength={128}
                  value={keyProject}
                  onChange={(event) => setKeyProject(event.target.value)}
                  placeholder={t("Leave blank to use the key's own project")}
                />
              </label>
              <p className="auth-consent-note">
                {t(
                  "This device connects directly to Volcano Ark. Native apps store credentials in system-protected storage; the web app keeps them only for this browser session. The assistant and runtime are created automatically on first use; cloud calls may be billed. Control-plane operations requiring STS still need SSO sign-in.",
                )}
              </p>
              <button
                className="button primary"
                disabled={busy || !apiKey.trim()}
              >
                {t("Connect with API Key")}
              </button>
            </form>
          ) : (
            <>
              <p className="settings-description">
                {t(
                  "Sign in on the Volcano website, then paste the authorization code shown on the page back here. This device exchanges the code directly with Volcano using PKCE. Credentials stay on this device; no Open Muse backend is involved.",
                )}
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
                  {t("Start SSO sign-in")}
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
                    {t("1. Authorize on Volcano")} <ExternalLink size={16} />
                  </a>
                  <label className="field">
                    {t("2. Paste the authorization code")}
                    <input
                      type="password"
                      autoComplete="off"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={t(
                        "Authorization code, encoded callback, or full callback URL",
                      )}
                    />
                  </label>
                  <small>
                    {t(
                      "The authorization link is valid for 10 minutes. Don't share the code with anyone.",
                    )}
                  </small>
                  <button
                    className="button secondary"
                    disabled={busy || !code.trim()}
                    onClick={() =>
                      void run(async () => {
                        await client.auth("complete", {
                          transaction: login.transaction,
                          code,
                        });
                        setCode("");
                        setLogin(undefined);
                        await statusAndProjects();
                      })
                    }
                  >
                    {t("Verify authorization code")}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setLogin(undefined);
                      setCode("");
                    }}
                  >
                    {t("Start over")}
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
            {t("Project")}
            <div className="project-select-wrap">
              <select
                aria-label={t("Select a project")}
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
              {t("Reload projects")}
            </button>
          )}
          <p className="auth-consent-note">
            {t(
              "Once connected, Muse creates a dedicated key in this project and automatically sets up the assistant and cloud runtime. The key can access all Ark resources in the project with no source-IP restriction; cloud calls may be billed. The cloud environment can reach the public internet, and tools run directly by default, which may cause external writes or deletions.",
            )}
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
            {status.apiKeyId
              ? t("Continue connecting")
              : t("Connect project and get started")}
          </button>
        </div>
      )}
      {status?.ready && (
        <div className="auth-connected">
          <p>
            {status.method === "api_key"
              ? t("Connected with API Key")
              : t("Connected with SSO")}{" "}
            ·{" "}
            {status.project ? (
              <>
                {t("Project")} <strong>{status.project}</strong>
              </>
            ) : (
              t("The key's own project")
            )}
          </p>
          <WorkspacePanel client={client} />
          {status.apiKeyId && (
            <details className="auth-key-details">
              <summary>{t("Key details")}</summary>
              <p className="muted">API Key ID: {status.apiKeyId}</p>
            </details>
          )}
        </div>
      )}
      {(status?.loggedIn || client.signedIn()) && (
        <div className="logout-row">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.auth("logout", {});
                onChanged();
              })
            }
          >
            <LogOut size={15} />
            {t("Sign out of this login")}
          </button>
          <small>
            {t(
              "Signing out removes this device's sign-in credentials but does not revoke the cloud API Key. You can revoke it in the Ark console. Switch sign-in methods by signing out first.",
            )}
          </small>
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          <LoaderCircle className="spin" size={15} />{" "}
          {t("Working, please don't submit again…")}
        </p>
      )}
    </section>
  );
}

export function AuthPanel(props: Parameters<typeof ArkAuthPanel>[0]) {
  return (
    <>
      <ArkAuthPanel {...props} />
      <BackgroundSettings client={props.client} />
    </>
  );
}
