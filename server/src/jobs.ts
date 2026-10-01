import { ApiError } from "../../shared/ark";
import { parseInspiration } from "../../shared/inspiration";
import { eventText } from "../../shared/types";
import { ArkRemote, type Remote } from "./ark";
import { backgroundReady, HttpError, type Env } from "./env";
import { Repository, type Run } from "./repository";
import { ConnectionStore } from "./connection";
import { authorizedOwners } from "./auth";
import { isSupabaseOwner, supabaseOrigin } from "../../shared/supabase-auth";
import { ACCOUNT_ACTIVITY_WINDOW } from "./account";
import { deliverDueUpcoming } from "./upcoming";

export async function processRun(
  repo: Repository,
  remote: Remote,
  clock = Date.now,
) {
  if (remote.owner !== repo.owner)
    throw new HttpError(
      409,
      "The task and Ark credentials belong to different users. No MA request was sent.",
    );
  const run = await repo.claim(clock());
  if (!run) return;
  let error: string | null = null;
  const attention = async (message: string) => {
    error = message;
    await repo.transition(
      run,
      run.phase,
      { phase: "needs_attention", error: message },
      clock(),
    );
  };
  try {
    if (clock() >= run.deadline_at) {
      await attention(
        "The local monitoring deadline elapsed. MA may still be running. Review its history before resuming checks.",
      );
      return;
    }
    const fingerprint = await remote.fingerprint();
    if (run.connection_hash && run.connection_hash !== fingerprint) {
      await attention(
        "The Ark connection changed. Restore the original connection to reconcile this run safely.",
      );
      return;
    }
    if (run.phase === "queued") {
      const prompt = await remote.prepare();
      await repo.transition(
        run,
        "queued",
        { phase: "creating", prompt, connection_hash: fingerprint },
        clock(),
      );
      const session = await remote.create(run.marker);
      if (!/^[\w-]{1,200}$/.test(session))
        throw new Error("Invalid session ID");
      await repo.transition(
        run,
        "creating",
        { phase: "ready", session_id: session },
        clock(),
      );
      return;
    }
    if (run.phase === "creating") {
      const hits = await remote.find(run.marker);
      if (hits.length === 1)
        await repo.transition(
          run,
          "creating",
          { phase: "ready", session_id: hits[0] },
          clock(),
        );
      else if (hits.length > 1)
        await attention(
          "Multiple matching sessions require review. No message was sent.",
        );
      else
        error =
          "Session creation is unconfirmed. History will be checked; creation will not be repeated.";
      return;
    }
    if (run.phase === "ready") {
      if (!run.session_id || !run.prompt) {
        await attention("The run is missing submission data.");
        return;
      }
      await remote.verify(run.session_id);
      await repo.transition(run, "ready", { phase: "sending" }, clock());
      await remote.send(run.session_id, run.event_id, run.prompt);
      await repo.transition(
        run,
        "sending",
        { phase: "running", prompt: "" },
        clock(),
      );
      return;
    }
    if (!run.session_id) {
      await attention("The run is missing a session reference.");
      return;
    }
    const events = await remote.events(run.session_id);
    const start = events.findIndex(
      (e) => e.id === run.event_id && e.type === "user.message",
    );
    if (start < 0) {
      error =
        "Message submission is unconfirmed. History will be checked; the message will not be repeated.";
      return;
    }
    const tail = events.slice(start + 1);
    const last = [...tail]
      .reverse()
      .find(
        (e) =>
          e.type.startsWith("session.status_") ||
          ["user.interrupt", "session.error"].includes(e.type),
      );
    if (last?.stop_reason?.type === "requires_action") {
      await attention(
        "MA requires user action. Review the original session; no tool was approved automatically.",
      );
      return;
    }
    if (
      tail.some((e) =>
        [
          "session.error",
          "user.interrupt",
          "session.status_terminated",
        ].includes(e.type),
      ) ||
      last?.stop_reason?.type === "retries_exhausted"
    ) {
      await repo.transition(
        run,
        run.phase,
        {
          phase: "failed",
          prompt: "",
          error: "MA stopped before producing a valid Feed.",
        },
        clock(),
      );
      error = "MA stopped before producing a valid Feed.";
      return;
    }
    if (last?.type !== "session.status_idle") return;
    const answer = [...tail].reverse().find((e) => e.type === "agent.message");
    try {
      if (!answer?.id) throw new Error();
      const items = parseInspiration(eventText(answer));
      if (items.some((item) => item.sources.length > 0)) throw new Error();
      await repo.finish(run, answer.id, items, clock());
    } catch {
      await attention(
        "MA returned invalid Feed content. Existing posts are unchanged; review the source session.",
      );
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      // Lost lease writes also fail here; do not bypass the fencing condition.
      try {
        await attention(e.message);
      } catch {
        /* Another invocation owns this run. */
      }
    } else if (
      e instanceof ApiError &&
      [400, 401, 403, 404, 413, 429].includes(e.status)
    ) {
      // Preserve the exact phase: even definite rejection is reviewed before
      // another external write, and credential changes must not switch ownership.
      await attention(
        `MA rejected a request (HTTP ${e.status}). Review the connection and original session.`,
      );
    } else
      error =
        "The upstream request could not be confirmed. The persisted phase will be reconciled without repeating writes.";
  } finally {
    await repo.release(run, clock(), error);
  }
}

export async function tick(
  env: Env,
  remoteFactory: (
    owner: string,
    connection: Env,
    fetcher: typeof fetch,
  ) => Remote = (_owner, connection, fetcher) =>
    new ArkRemote(connection, fetcher),
  clock = Date.now,
) {
  if (env.BACKGROUND_ENABLED !== "true") return;
  let owners: string[] = [];
  try {
    owners = authorizedOwners(env);
  } catch {
    // Account-only deployments have no private device bindings.
  }
  // Account owners only exist after a verified session created their rows.
  // They are scheduled only while their key was stored under the configured
  // issuer and they recently made a verified request. Each owner still
  // resolves only its own sealed connection below.
  let issuer = "";
  try {
    issuer = supabaseOrigin(env.SUPABASE_AUTH_URL);
  } catch {
    // An invalid issuer disables account scheduling.
  }
  // Bounded, oldest-due-first tenant selection. An error in one tenant cannot
  // cause its key to be reused for another tenant or starve all other owners.
  const due = await env.DB.prepare(
    `SELECT owner_id FROM (
    SELECT owner_id,next_check_at AS due_at FROM runs WHERE phase NOT IN ('complete','failed','needs_attention') AND next_check_at<=?
    UNION ALL SELECT owner_id,next_run_at AS due_at FROM schedules WHERE enabled=1 AND next_run_at<=?
  ) WHERE owner_id IN (SELECT value FROM json_each(?)) OR (owner_id GLOB 'muse_user_*' AND owner_id IN (
    SELECT owner_id FROM account_credentials WHERE encrypted IS NOT NULL AND issuer=? AND last_seen_at>=?))
  GROUP BY owner_id ORDER BY min(due_at),owner_id LIMIT 20`,
  )
    .bind(
      clock(),
      clock(),
      JSON.stringify(owners),
      issuer,
      clock() - ACCOUNT_ACTIVITY_WINDOW,
    )
    .all<{ owner_id: string }>();
  for (const { owner_id: owner } of due.results) {
    if (!owners.includes(owner) && !isSupabaseOwner(owner)) continue;
    try {
      const store = new ConnectionStore(env, owner);
      const connection = await store.resolve();
      if (!connection || !backgroundReady(connection.env)) continue;
      const remote = remoteFactory(
        owner,
        connection.env,
        store.guardedFetch(connection.revision),
      );
      const repo = new Repository(env.DB, owner);
      await repo.dispatchDue(clock(), {
        revision: connection.revision,
        hash: await remote.fingerprint(),
      });
      await processRun(repo, remote, clock);
    } catch {
      /* Fail closed for this owner. Do not log private upstream state. */
    }
  }
  // Reminders due in each account's UPCOMING.md, under the same account gate.
  await deliverDueUpcoming(
    env,
    issuer,
    clock() - ACCOUNT_ACTIVITY_WINDOW,
    clock(),
  );
}
