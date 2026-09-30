import { ApiError } from "../../shared/ark";
import { parseInspiration } from "../../shared/inspiration";
import { eventText } from "../../shared/types";
import { ArkRemote, type Remote } from "./ark";
import { backgroundReady, HttpError, type Env } from "./env";
import { Repository, type Run } from "./repository";

export async function processRun(
  repo: Repository,
  remote: Remote,
  clock = Date.now,
) {
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
      await remote.verify();
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
  remote: Remote = new ArkRemote(env),
  clock = Date.now,
) {
  if (!backgroundReady(env)) return;
  const repo = new Repository(env.DB, env.OWNER_ID);
  await repo.dispatchDue(clock());
  await processRun(repo, remote, clock);
}
