import { formatLocale, t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  BackgroundPost,
  BackgroundRun,
  BackgroundSchedule,
  BackgroundStatus,
} from "../shared/background";
import { backgroundClient, type BackgroundClient } from "./background-client";
import type { Client } from "./api";
import { Markdown } from "./components";
import "./background.css";

export function BackgroundSettings({
  service = backgroundClient,
  client,
}: {
  service?: BackgroundClient;
  client?: Pick<Client, "backgroundConfiguration" | "signedIn"> &
    Partial<Pick<Client, "accountCredentialRevision">>;
}) {
  const [connected, setConnected] = useState(false),
    [status, setStatus] = useState<BackgroundStatus>();
  const [schedule, setSchedule] = useState<BackgroundSchedule>(),
    [runs, setRuns] = useState<BackgroundRun[]>([]),
    [posts, setPosts] = useState<BackgroundPost[]>([]);
  const [token, setToken] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  const [uploadConsent, setUploadConsent] = useState(false),
    [removeConsent, setRemoveConsent] = useState(false);
  const lock = useRef(false),
    alive = useRef(true),
    dirtyRef = useRef(false);
  const load = async () => {
    const result = await service.refresh();
    if (!alive.current) return;
    setStatus(result.status);
    setRuns(result.runs);
    setPosts(result.items);
    if (!dirtyRef.current) setSchedule(result.status.schedule);
  };
  const action = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setConnected(service.connected());
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void action(async () => {
      await service.restore();
      if (!alive.current) return;
      setConnected(service.connected());
      if (service.connected()) {
        const cache = await service.cachedFeed();
        if (alive.current) setPosts(cache.items);
        await load();
      }
    });
    const foreground = () => {
      if (!document.hidden && service.connected()) void action(load);
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", foreground);
    };
  }, [service]);
  function change(patch: Partial<BackgroundSchedule>) {
    dirtyRef.current = true;
    setDirty(true);
    setSchedule((current) => (current ? { ...current, ...patch } : current));
  }
  // Signed in with a Muse account rather than a private device token.
  const account = connected && Boolean(service.accountConnected?.());
  return (
    <section
      className="settings-card background-panel"
      aria-label={t("Background Feed")}
    >
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <Clock3 size={21} />
        </div>
        <div>
          <h2>{t("While you're away")}</h2>
          <p>{t("A daily Feed, prepared without keeping either app open")}</p>
        </div>
        <span className="small-badge">
          {connected
            ? status?.schedule.enabled
              ? t("Scheduled")
              : t("Connected")
            : t("Optional")}
        </span>
      </div>
      {!service.configured() ? (
        <p className="background-note">
          {t(
            "This build has no background service configured. Direct Ark conversations still work. Set the public API origin when building the app to enable this connection.",
          )}
        </p>
      ) : (
        <>
          <p className="background-origin">{service.origin}</p>
          {!connected && service.accountConfigured?.() ? (
            <p className="background-note">
              {t(
                "Sign in to your Muse account above to use background features.",
              )}
            </p>
          ) : !connected ? (
            <form
              className="background-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  try {
                    const next = await service.connect(token.trim());
                    if (alive.current) {
                      setStatus(next);
                      setSchedule(next.schedule);
                    }
                  } finally {
                    setToken("");
                  }
                  await load();
                });
              }}
            >
              <label className="field">
                {t("Device token")}
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="muse_device_…"
                  required
                  disabled={busy}
                />
              </label>
              <p className="background-note">
                <ShieldCheck size={16} />{" "}
                {t(
                  "Use a private Muse device token, never an Ark key or Cloudflare token. The token stays in this app's separate Keychain entry.",
                )}
              </p>
              <button
                className="button primary"
                disabled={busy || !token.trim()}
              >
                {t("Connect background service")}
              </button>
            </form>
          ) : (
            <>
              {!account && (
                <p className="background-note">
                  {t("Private service account:")}{" "}
                  {status?.owner ?? t("Checking…")}.{" "}
                  {t(
                    "This connection is independent of the Ark login above. Signing out of Ark does not stop this schedule.",
                  )}
                </p>
              )}
              {status && !status.backgroundReady && (
                <p className="background-note">
                  {t(
                    "The server is connected, but background MA access is disabled or not configured. No generation can start yet.",
                  )}
                </p>
              )}
              {client && (
                <div className="background-authorization">
                  <h3>
                    {account
                      ? t("Allow background work with this workspace")
                      : t("Use your current Ark workspace")}
                  </h3>
                  <p className="background-note">
                    {account
                      ? t(
                          "Your Ark API key is already saved in your Muse account. Allowing background work lets the service use it with this workspace's agent, environment, and memory while you are away. The service keeps this binding encrypted and its administrators remain trusted; this is not end-to-end encryption.",
                        )
                      : t(
                          "No second key or agent to configure. Sync the API key, project, agent version, environment, and memory-store IDs from this app. The service stores the configuration encrypted and decrypts it to call Ark while you are away. Its administrators remain trusted; this is not end-to-end encryption.",
                        )}
                  </p>
                  <p className="background-note" role="status">
                    {status?.connection?.configured
                      ? `${account ? t("Background work allowed") : t("Configuration uploaded")}${status.connection.updatedAt ? ` · ${new Date(status.connection.updatedAt).toLocaleString(formatLocale())}` : ""}`
                      : account
                        ? t("Background work is not allowed yet.")
                        : t("No app configuration uploaded.")}
                    {status &&
                      !status.credentialStorageReady &&
                      t("Encrypted storage is not available yet.")}
                  </p>
                  <label className="background-consent">
                    <input
                      type="checkbox"
                      checked={uploadConsent}
                      disabled={
                        busy ||
                        !client.signedIn() ||
                        !status?.credentialStorageReady
                      }
                      onChange={(event) =>
                        setUploadConsent(event.target.checked)
                      }
                    />
                    {account
                      ? t(
                          "I allow the Muse service to use my saved Ark API key with this workspace for background Feed generation. Personal context will be read from Ark. Cloud calls may be billed.",
                        )
                      : t(
                          "I authorize uploading this app's current Ark configuration to this private service for background Feed generation. Personal context will be read from Ark. Cloud calls may be billed.",
                        )}
                  </label>
                  <div className="background-actions">
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !uploadConsent ||
                        !client.signedIn() ||
                        !status?.credentialStorageReady
                      }
                      onClick={() =>
                        void action(async () => {
                          await service.syncConfiguration(client);
                          setUploadConsent(false);
                          dirtyRef.current = false;
                          setDirty(false);
                          setConsent(false);
                          await load();
                          setNotice(
                            account
                              ? t(
                                  "Background work is allowed for this workspace. Review the schedule before enabling it.",
                                )
                              : t(
                                  "Current Ark configuration synced. A changed connection pauses the schedule; review it before enabling. Generation remains subject to the server's safety checks.",
                                ),
                          );
                        })
                      }
                    >
                      {account
                        ? t("Allow background work")
                        : t("Sync current Ark configuration")}
                    </button>
                  </div>
                  {status?.connection?.configured && (
                    <>
                      <label className="background-consent background-remove-consent">
                        <input
                          type="checkbox"
                          checked={removeConsent}
                          disabled={busy}
                          onChange={(event) =>
                            setRemoveConsent(event.target.checked)
                          }
                        />
                        {t(
                          "Remove the uploaded configuration and pause future runs. Already submitted MA work will not be cancelled.",
                        )}
                      </label>
                      <button
                        className="button secondary"
                        disabled={busy || !removeConsent}
                        onClick={() =>
                          void action(async () => {
                            await service.removeConfiguration();
                            setRemoveConsent(false);
                            setUploadConsent(false);
                            dirtyRef.current = false;
                            setDirty(false);
                            setConsent(false);
                            await load();
                            setNotice(
                              t(
                                "Uploaded access removed and the schedule paused. Existing MA work may still run; the original Ark key remains valid until revoked in Ark. Older encrypted backups may remain.",
                              ),
                            );
                          })
                        }
                      >
                        {account
                          ? t("Stop background work")
                          : t("Remove uploaded Ark access")}
                      </button>
                    </>
                  )}
                </div>
              )}
              {schedule && (
                <form
                  className="background-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      const saved = await service.saveSchedule(schedule);
                      dirtyRef.current = false;
                      setDirty(false);
                      setConsent(false);
                      setSchedule(saved);
                      await load();
                      setNotice(
                        saved.enabled
                          ? t(
                              "Daily schedule saved. MA calls may incur charges.",
                            )
                          : t(
                              "Future scheduled runs are paused. Existing runs are not cancelled.",
                            ),
                      );
                    });
                  }}
                >
                  <label className="background-toggle">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      disabled={
                        busy || (!status?.backgroundReady && !schedule.enabled)
                      }
                      onChange={(e) => change({ enabled: e.target.checked })}
                    />
                    {t("Prepare a daily Feed")}
                  </label>
                  <div className="background-time">
                    <label className="field">
                      {t("Local time")}
                      <input
                        type="time"
                        value={schedule.local_time}
                        disabled={busy}
                        required
                        onChange={(e) => change({ local_time: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      {t("Timezone")}
                      <input
                        value={schedule.timezone}
                        disabled={busy}
                        required
                        onChange={(e) => change({ timezone: e.target.value })}
                        placeholder="Asia/Shanghai"
                      />
                    </label>
                  </div>
                  {schedule.enabled && dirty && (
                    <label className="background-consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        disabled={busy}
                      />
                      {t(
                        "I authorize unattended generation using this private service's configured Ark account. Cloud calls may be billed.",
                      )}
                    </label>
                  )}
                  <div className="background-actions">
                    <button
                      className="button primary"
                      disabled={
                        busy || !dirty || (schedule.enabled && !consent)
                      }
                    >
                      {t("Save schedule")}
                    </button>
                    {dirty && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          dirtyRef.current = false;
                          setDirty(false);
                          setConsent(false);
                          if (status) setSchedule(status.schedule);
                        }}
                      >
                        {t("Discard changes")}
                      </button>
                    )}
                  </div>
                  {status?.schedule.next_run_at && (
                    <small>
                      {t("Next due:")}{" "}
                      {new Date(status.schedule.next_run_at).toLocaleString(
                        formatLocale(),
                      )}
                      . Checked approximately every five minutes.
                    </small>
                  )}
                </form>
              )}
              <div className="background-actions">
                <button
                  className="button secondary"
                  disabled={busy || !status?.backgroundReady}
                  onClick={() =>
                    void action(async () => {
                      const run = await service.generate();
                      await load();
                      setNotice(
                        run.phase === "queued"
                          ? t(
                              "The run is queued. You can close the app; the server will continue.",
                            )
                          : t(
                              "The generation request is confirmed: {phase}. See recent runs for details.",
                              { phase: t(run.phase.replaceAll("_", " ")) },
                            ),
                      );
                    })
                  }
                >
                  {service.pending()
                    ? t("Check previous generation request")
                    : t("Generate once · may incur charges")}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(load)}
                >
                  <RefreshCw size={15} /> {t("Refresh")}
                </button>
              </div>
              {runs.length > 0 && (
                <details className="background-runs">
                  <summary>{t("Recent runs")}</summary>
                  {runs.map((run) => (
                    <div key={run.id} className="background-run">
                      <strong>{t(run.phase.replaceAll("_", " "))}</strong>
                      <time>
                        {new Date(run.created_at).toLocaleString(
                          formatLocale(),
                        )}
                      </time>
                      {run.error && <p>{run.error}</p>}
                      {run.session_id && (
                        <small>
                          {t("MA session:")} {run.session_id}
                        </small>
                      )}
                      {run.phase === "needs_attention" && (
                        <button
                          className="button secondary"
                          disabled={busy || !status?.backgroundReady}
                          onClick={() =>
                            void action(async () => {
                              await service.recheck(run.id);
                              await load();
                            })
                          }
                        >
                          {t("Resume checks after review")}
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              )}
              <div
                className="background-feed"
                aria-label={t("Background Feed results")}
              >
                <h3>{t("Prepared for you")}</h3>
                <p className="background-note">
                  {t(
                    "Personalized ideas from your cloud memory, not live news. Cached posts remain on this device.",
                  )}
                </p>
                {posts.length ? (
                  posts.map((post) => (
                    <article key={post.id} className="background-post">
                      <span aria-hidden="true">{post.emoji}</span>
                      <h4>{post.title}</h4>
                      <Markdown text={post.body} />
                      <small>{post.reason}</small>
                      <details>
                        <summary>{t("Source")}</summary>
                        <p>
                          {t("MA session:")} {post.session_id}
                          <br />
                          {t("Event:")} {post.event_id}
                        </p>
                      </details>
                    </article>
                  ))
                ) : (
                  <p className="background-note">
                    {t(
                      "No background posts yet. Results appear here after a confirmed generation.",
                    )}
                  </p>
                )}
              </div>
            </>
          )}
          {!account && (connected || !service.accountConfigured?.()) && (
            <div className="background-disconnect">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await service.disconnect();
                    setStatus(undefined);
                    setSchedule(undefined);
                    setPosts([]);
                    setRuns([]);
                    dirtyRef.current = false;
                    setDirty(false);
                    setConsent(false);
                    setUploadConsent(false);
                    setRemoveConsent(false);
                  })
                }
              >
                {t("Remove this device connection")}
              </button>
              <small>
                {t(
                  "Removes the local token only. Pause the schedule before disconnecting to stop future automatic runs; revoke this device's token on the server if needed.",
                )}
              </small>
            </div>
          )}
        </>
      )}
      {busy && (
        <p className="background-note" role="status">
          {t("Checking the background service…")}
        </p>
      )}
      {notice && (
        <p className="background-note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
