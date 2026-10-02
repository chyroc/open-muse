import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Session } from "../shared/types";
import { mergeEvents, mergeHistorySnapshot } from "../shared/types";
import type { Client } from "./api";
import { AutoApprover } from "./autoApprove";

export function useTask(client: Client, id?: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(Boolean(id));
  // The conversation the state above belongs to. Until the effect below runs
  // for a new id, report it as loading rather than briefly empty.
  const [current, setCurrent] = useState(id);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [autoApprovalFailures, setAutoApprovalFailures] = useState<string[]>(
    [],
  );
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => syncRef.current(), []);
  useEffect(() => {
    setEvents([]);
    setSession(undefined);
    setError("");
    setLoading(Boolean(id));
    setCurrent(id);
    setConnected(false);
    setAutoApprovalFailures([]);
    if (!id) return;
    const controller = new AbortController();
    const { signal } = controller;
    let syncing = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let resync: ReturnType<typeof setTimeout>;
    let retry = 0;
    let historyLoaded = false;
    let knownEvents: AgentEvent[] = [];
    const receive = (incoming: AgentEvent[]) => {
      if (signal.aborted) return;
      knownEvents = mergeEvents(knownEvents, incoming);
      setEvents(knownEvents);
      if (historyLoaded)
        approver.observe(
          knownEvents.filter(
            (event) =>
              !event.source_session_id || event.source_session_id === id,
          ),
        );
    };
    const approver = new AutoApprover(client, id, signal, receive, (toolId) => {
      setAutoApprovalFailures((current) => [...new Set([...current, toolId])]);
    });
    const sync = async () => {
      if (syncing || signal.aborted) return;
      syncing = true;
      const beforeRead = knownEvents;
      try {
        const [history, remote] = await Promise.all([
          client.events(id, signal),
          client.session(id, signal),
        ]);
        if (signal.aborted) return;
        historyLoaded = true;
        receive(mergeHistorySnapshot(beforeRead, knownEvents, history));
        setSession(remote);
        setError("");
      } catch (err) {
        if (signal.aborted) return;
        // A request the system cut off, as when the app was in the
        // background, is read again shortly instead of shown as an error.
        if (["AbortError", "TimeoutError"].includes((err as Error).name)) {
          clearTimeout(resync);
          resync = setTimeout(() => void sync(), 2000);
        } else setError((err as Error).message);
      } finally {
        syncing = false;
        if (!signal.aborted) setLoading(false);
      }
    };
    syncRef.current = sync;
    const connect = async () => {
      if (signal.aborted) return;
      try {
        await client.stream(
          id,
          signal,
          (event) => {
            receive([event]);
          },
          () => {
            if (signal.aborted) return;
            retry = 0;
            setConnected(true);
            // Ark SSE has no history replay: pull history again after the subscription is established to cover the connection window.
            void sync();
          },
        );
      } catch {
        /* After the stream drops, keep periodically pulling history; reconnects do not resend user messages. */
      }
      if (!signal.aborted) {
        setConnected(false);
        reconnect = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      }
    };
    void connect();
    void sync();
    const interval = setInterval(sync, 6000);
    const foreground = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => {
      controller.abort();
      clearTimeout(reconnect);
      clearTimeout(resync);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", foreground);
      syncRef.current = async () => {};
    };
  }, [client, id]);
  const stale = current !== id;
  return {
    events: stale ? [] : events,
    session: stale ? undefined : session,
    loading: loading || (stale && Boolean(id)),
    error,
    connected,
    refresh,
    autoApprovalFailures,
  };
}
