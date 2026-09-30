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
  client?: Pick<Client, "backgroundConfiguration" | "signedIn">;
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
  return (
    <section
      className="settings-card background-panel"
      aria-label="Background Feed"
    >
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <Clock3 size={21} />
        </div>
        <div>
          <h2>While you're away</h2>
          <p>A daily Feed, prepared without keeping either app open</p>
        </div>
        <span className="small-badge">
          {connected
            ? status?.schedule.enabled
              ? "Scheduled"
              : "Connected"
            : "Optional"}
        </span>
      </div>
      {!service.configured() ? (
        <p className="background-note">
          This build has no background service configured. Direct Ark
          conversations still work. Set the public API origin when building the
          app to enable this connection.
        </p>
      ) : (
        <>
          <p className="background-origin">{service.origin}</p>
          {!connected ? (
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
                Device token
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
                <ShieldCheck size={16} /> Use a private Muse device token, never
                an Ark key or Cloudflare token. The token stays in this app's
                separate Keychain entry.
              </p>
              <button
                className="button primary"
                disabled={busy || !token.trim()}
              >
                Connect background service
              </button>
            </form>
          ) : (
            <>
              <p className="background-note">
                Private service account: {status?.owner ?? "Checking…"}. This
                connection is independent of the Ark login above. Signing out of
                Ark does not stop this schedule.
              </p>
              {status && !status.backgroundReady && (
                <p className="background-note">
                  The server is connected, but background MA access is disabled
                  or not configured. No generation can start yet.
                </p>
              )}
              {client && (
                <div className="background-authorization">
                  <h3>{"Use your current Ark workspace"}</h3>
                  <p className="background-note">
                    {
                      "No second key or agent to configure. Sync the API key, project, agent version, environment, and memory-store IDs from this app. SSO and refresh credentials stay on-device. The service stores the configuration encrypted and decrypts it to call Ark while you are away. Its administrators remain trusted; this is not end-to-end encryption."
                    }
                  </p>
                  <p className="background-note" role="status">
                    {status?.connection?.configured
                      ? `Configuration uploaded${status.connection.updatedAt ? ` · ${new Date(status.connection.updatedAt).toLocaleString()}` : ""}`
                      : "No app configuration uploaded."}
                    {status &&
                      !status.credentialStorageReady &&
                      "Encrypted storage is not available yet."}
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
                    {
                      "I authorize uploading this app's current Ark configuration to this private service for background Feed generation. Personal context will be read from Ark. Cloud calls may be billed."
                    }
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
                            "Current Ark configuration synced. A changed connection pauses the schedule; review it before enabling. Generation remains subject to the server's safety checks.",
                          );
                        })
                      }
                    >
                      {"Sync current Ark configuration"}
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
                        {
                          "Remove the uploaded configuration and pause future runs. Already submitted MA work will not be cancelled."
                        }
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
                              "Uploaded access removed and the schedule paused. Existing MA work may still run; the original Ark key remains valid until revoked in Ark. Older encrypted backups may remain.",
                            );
                          })
                        }
                      >
                        {"Remove uploaded Ark access"}
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
                          ? "Daily schedule saved. MA calls may incur charges."
                          : "Future scheduled runs are paused. Existing runs are not cancelled.",
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
                    Prepare a daily Feed
                  </label>
                  <div className="background-time">
                    <label className="field">
                      Local time
                      <input
                        type="time"
                        value={schedule.local_time}
                        disabled={busy}
                        required
                        onChange={(e) => change({ local_time: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Timezone
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
                      I authorize unattended generation using this private
                      service's configured Ark account. Cloud calls may be
                      billed.
                    </label>
                  )}
                  <div className="background-actions">
                    <button
                      className="button primary"
                      disabled={
                        busy || !dirty || (schedule.enabled && !consent)
                      }
                    >
                      Save schedule
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
                        Discard changes
                      </button>
                    )}
                  </div>
                  {status?.schedule.next_run_at && (
                    <small>
                      Next due:{" "}
                      {new Date(status.schedule.next_run_at).toLocaleString()}.
                      Checked approximately every five minutes.
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
                          ? "The run is queued. You can close the app; the server will continue."
                          : `The generation request is confirmed: ${run.phase.replaceAll("_", " ")}. See recent runs for details.`,
                      );
                    })
                  }
                >
                  {service.pending()
                    ? "Check previous generation request"
                    : "Generate once · may incur charges"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(load)}
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              {runs.length > 0 && (
                <details className="background-runs">
                  <summary>Recent runs</summary>
                  {runs.map((run) => (
                    <div key={run.id} className="background-run">
                      <strong>{run.phase.replaceAll("_", " ")}</strong>
                      <time>{new Date(run.created_at).toLocaleString()}</time>
                      {run.error && <p>{run.error}</p>}
                      {run.session_id && (
                        <small>MA session: {run.session_id}</small>
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
                          Resume checks after review
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              )}
              <div
                className="background-feed"
                aria-label="Background Feed results"
              >
                <h3>Prepared for you</h3>
                <p className="background-note">
                  Personalized ideas from your cloud memory, not live news.
                  Cached posts remain on this device.
                </p>
                {posts.length ? (
                  posts.map((post) => (
                    <article key={post.id} className="background-post">
                      <span aria-hidden="true">{post.emoji}</span>
                      <h4>{post.title}</h4>
                      <Markdown text={post.body} />
                      <small>{post.reason}</small>
                      <details>
                        <summary>Source</summary>
                        <p>
                          MA session: {post.session_id}
                          <br />
                          Event: {post.event_id}
                        </p>
                      </details>
                    </article>
                  ))
                ) : (
                  <p className="background-note">
                    No background posts yet. Results appear here after a
                    confirmed generation.
                  </p>
                )}
              </div>
            </>
          )}
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
              Remove this device connection
            </button>
            <small>
              Removes the local token only. Pause the schedule before
              disconnecting to stop future automatic runs; revoke this device's
              token on the server if needed.
            </small>
          </div>
        </>
      )}
      {busy && (
        <p className="background-note" role="status">
          Checking the background service…
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
