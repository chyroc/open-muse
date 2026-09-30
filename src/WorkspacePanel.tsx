import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { Client } from "./api";
import type { WorkspaceStatus } from "../shared/types";

export function WorkspacePanel({ client }: { client: Client }) {
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await client.request<WorkspaceStatus>("/workspace", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setStatus(value);
          setError("");
        }
        if (value.state === "preparing" && !abort.signal.aborted)
          timer = setTimeout(() => void read(), 1000);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, busy]);
  const preparing = busy || status?.state === "preparing";
  async function prepare() {
    if (busy || (preparing && !error)) return;
    setBusy(true);
    setError("");
    try {
      setStatus(
        await client.request<WorkspaceStatus>(
          !status || error ? "/workspace" : "/workspace/prepare",
          !status || error
            ? {}
            : {
                method: "POST",
                body: "{}",
              },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card" aria-label="Personal workspace">
      <div className="workspace-heading">
        {preparing ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <Check size={20} />
        )}
        <div>
          <h3>Personal workspace</h3>
          <p>
            The assistant and runtime are managed automatically by Muse, no
            manual setup needed.
          </p>
          <p>
            The cloud environment can access the public internet; tools in new
            tasks run directly by default and may cause external writes,
            deletions, or charges.
          </p>
        </div>
        <span className="small-badge">
          {preparing
            ? "Preparing"
            : status?.state === "ready"
              ? "Ready"
              : status?.state === "demo"
                ? "Not connected"
                : "Needs setup"}
        </span>
      </div>
      <p role="status">
        {error || status?.message || "Reading workspace status…"}
      </p>
      {status?.state === "ready" ? (
        <a className="button primary" href="#/">
          Start something new
        </a>
      ) : (
        status?.state !== "demo" && (
          <button
            className="button secondary"
            disabled={busy || (preparing && !error)}
            onClick={() => void prepare()}
          >
            {preparing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            {error
              ? "Read status again"
              : preparing
                ? "Setting up automatically…"
                : status?.state === "error"
                  ? "Continue setup"
                  : "Set up workspace"}
          </button>
        )
      )}
      {status?.state === "demo" && (
        <a className="button secondary" href="#/settings">
          Sign in and connect a project
        </a>
      )}
    </section>
  );
}
