import { formatLocale, t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
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
  const [consent, setConsent] = useState(false),
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
            "Background features need an Open Muse account, and this build has no account service. Direct Ark conversations still work.",
          )}
        </p>
      ) : (
        <>
          <p className="background-origin">{service.origin}</p>
          {!connected ? (
            <p className="background-note">
              {t(
                "Sign in to your Open Muse account above to use background features.",
              )}
            </p>
          ) : (
            <>
              {status && !status.backgroundReady && (
                <p className="background-note">
                  {t(
                    "The server is connected, but background MA access is disabled or not configured. No generation can start yet.",
                  )}
                </p>
              )}
              {client && (
                <div className="background-authorization">
                  <h3>{t("Allow background work with this workspace")}</h3>
                  <p className="background-note">
                    {t(
                      "Your Ark API key is already saved in your Open Muse account. Allowing background work lets the service use it with this workspace's agent, environment, and memory while you are away. The service keeps this binding encrypted and its administrators remain trusted; this is not end-to-end encryption.",
                    )}
                  </p>
                  <p className="background-note" role="status">
                    {status?.connection?.configured
                      ? `${t("Background work allowed")}${status.connection.updatedAt ? ` · ${new Date(status.connection.updatedAt).toLocaleString(formatLocale())}` : ""}`
                      : t("Background work is not allowed yet.")}
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
                    {t(
                      "I allow the Open Muse service to use my saved Ark API key with this workspace for background Feed generation. Personal context will be read from Ark. Cloud calls may be billed.",
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
                            t(
                              "Background work is allowed for this workspace. Review the schedule before enabling it.",
                            ),
                          );
                        })
                      }
                    >
                      {t("Allow background work")}
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
                        {t("Stop background work")}
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
                        "I authorize unattended generation with the Ark API key saved in my Open Muse account. Cloud calls may be billed.",
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
