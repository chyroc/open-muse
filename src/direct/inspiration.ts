import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import { digest, uuid } from "../../shared/crypto";
import {
  eventText,
  pendingPermissions,
  type AgentEvent,
  type Session,
} from "../../shared/types";
import {
  defaultFeedInstructions,
  parseInspiration,
  type InspirationItem,
  type InspirationKind,
  type InspirationRun,
  type InspirationSnapshot,
} from "../../shared/inspiration";
import { LocalDatabase } from "./storage";

type State = Pick<
  InspirationSnapshot,
  "items" | "runs" | "instructionsDismissed"
>;
type Remote = {
  instructions(): Promise<InspirationSnapshot["instructions"]>;
  prepare(kind: InspirationKind, state: State): Promise<string>;
  list(): Promise<Session[]>;
  create(title: string): Promise<Session>;
  events(id: string): Promise<AgentEvent[]>;
  send(id: string, event: AgentEvent): Promise<unknown>;
};
const empty = (): State => ({
  items: [],
  runs: {},
  instructionsDismissed: false,
});
const active = (run?: InspirationRun) =>
  run && !["complete", "failed"].includes(run.phase);
const rejected = (error: unknown) =>
  error instanceof ApiError &&
  [400, 401, 403, 404, 413, 429].includes(error.status);
const phases: InspirationRun["phase"][] = [
  "preparing",
  "creating",
  "ready",
  "sending",
  "running",
  "complete",
  "failed",
];
function validSession(id: string) {
  if (!/^[\w-]{1,200}$/.test(id ?? ""))
    throw new ApiError(
      502,
      t(
        "The generation session ID is unconfirmed. Refresh before proceeding; no duplicate was created.",
      ),
    );
  return id;
}

// The cloud session is authoritative for generated content. This device-local
// index stores presentation, reactions, and write guards scoped to one identity.
export class DirectInspiration {
  private key: string;
  constructor(
    owner: string,
    private db: LocalDatabase,
    private remote: Remote,
  ) {
    this.key = `${owner}:inspiration:v1`;
    this.instructionsKey = `${owner}:inspiration:instructions:v1`;
  }
  // The feed instructions as last read, so the page can show at once.
  private instructionsKey: string;
  private async state() {
    return (await this.db.get<State>(this.key)) ?? empty();
  }
  private update(fn: (state: State) => void) {
    return this.db.update<State>(this.key, (old) => {
      const state = old ?? empty();
      fn(state);
      return state;
    });
  }
  private patch(
    kind: InspirationKind,
    token: string,
    patch: Partial<InspirationRun>,
  ) {
    return this.update((state) => {
      const run = state.runs[kind];
      if (run?.token !== token)
        throw new ApiError(
          409,
          t("This generation changed in another window. Refresh to continue."),
        );
      if (
        ["complete", "failed"].includes(run.phase) ||
        (patch.phase && phases.indexOf(patch.phase) < phases.indexOf(run.phase))
      )
        return;
      Object.assign(run, patch);
    });
  }
  async snapshot(): Promise<InspirationSnapshot> {
    const instructions = await this.remote.instructions();
    await this.db.set(this.instructionsKey, instructions);
    return { ...(await this.state()), instructions };
  }
  // What this device already has: its posts and ideas, with the
  // instructions as last read. The cloud read follows with snapshot().
  async cached(): Promise<InspirationSnapshot> {
    const instructions = await this.db.get<InspirationSnapshot["instructions"]>(
      this.instructionsKey,
    );
    return {
      ...(await this.state()),
      instructions: instructions ?? {
        content: defaultFeedInstructions,
        revision: digest(defaultFeedInstructions),
      },
    };
  }
  async dismissInstructions() {
    await this.update((state) => {
      state.instructionsDismissed = true;
    });
  }
  async like(id: string, liked: boolean) {
    await this.update((state) => {
      const item = state.items.find((item) => item.id === id);
      if (!item) throw new ApiError(404, t("Post not found."));
      item.liked = liked;
    });
  }
  async link(id: string, session: string) {
    await this.update((state) => {
      const item = state.items.find((item) => item.id === id);
      if (!item) throw new ApiError(404, t("Post not found."));
      if (item.discussion_id && item.discussion_id !== session)
        throw new ApiError(
          409,
          t("This post already has a discussion. Open it from the feed."),
        );
      item.discussion_id = session;
    });
  }
  async refresh(kind: InspirationKind) {
    const run = (await this.state()).runs[kind];
    if (!active(run)) return;
    if (run!.phase === "creating") {
      const hits = (await this.remote.list()).filter(
        (s) => s.title === run!.token,
      );
      if (hits.length !== 1) return;
      await this.patch(kind, run!.token, {
        session_id: validSession(hits[0].id),
        phase: "ready",
        error: undefined,
      });
      return;
    }
    if (!run!.session_id || !["sending", "running"].includes(run!.phase))
      return;
    const events = await this.remote.events(run!.session_id);
    const start = events.findIndex((e) => e.id === run!.event_id);
    if (start < 0) return; // Never repeat an ambiguous message POST.
    const tail = events.slice(start + 1);
    const last = [...tail]
      .reverse()
      .find(
        (event) =>
          event.type.startsWith("session.status_") ||
          event.type === "user.interrupt" ||
          event.type === "session.error",
      );
    const pending = pendingPermissions(tail);
    if (pending.length) {
      await this.patch(kind, run!.token, {
        phase: "running",
        error:
          "An action needs approval. Open the generation conversation to review it.",
      });
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
      await this.patch(kind, run!.token, {
        phase: "failed",
        error:
          "Generation stopped before producing valid content. Your existing posts are unchanged.",
      });
      return;
    }
    if (
      last?.type !== "session.status_idle" ||
      last.stop_reason?.type === "requires_action"
    ) {
      await this.patch(kind, run!.token, {
        phase: "running",
        error: undefined,
      });
      return;
    }
    const answer = [...tail].reverse().find((e) => e.type === "agent.message");
    try {
      if (!answer)
        throw new Error(
          t(
            "Generation finished without a reply. Open the conversation to inspect it.",
          ),
        );
      const content = parseInspiration(eventText(answer));
      await this.update((state) => {
        const current = state.runs[kind];
        if (
          current?.token !== run!.token ||
          ["complete", "failed"].includes(current.phase)
        )
          return;
        const items: InspirationItem[] = content.map((item, i) => ({
          ...item,
          id: `${run!.token}-${i}`,
          kind,
          session_id: run!.session_id!,
          event_id: answer.id,
          created_at: answer.created_at ?? run!.created_at,
          liked: false,
        }));
        state.items.unshift(...items);
        current.phase = "complete";
        delete current.error;
        delete current.prompt;
      });
    } catch (error) {
      await this.patch(kind, run!.token, {
        phase: "failed",
        error: (error as Error).message,
      });
    }
  }
  async generate(kind: InspirationKind) {
    // Resumable reads can recover a lost create response, but only an explicit
    // generation action may provision resources or submit the prepared message.
    await this.refresh(kind);
    let state = await this.state();
    let run = state.runs[kind];
    if (!active(run)) {
      run = {
        token: `open-muse-${kind}-${uuid()}`,
        kind,
        phase: "preparing",
        created_at: new Date().toISOString(),
        event_id: `evt-${uuid()}`,
      };
      const fresh = run;
      state = await this.update((current) => {
        if (active(current.runs[kind]))
          throw new ApiError(
            409,
            t("Generation is already in progress. Refresh to see it."),
          );
        current.runs[kind] = fresh;
      });
    }
    const token = run!.token;
    if (run!.phase === "preparing") {
      const prompt = await this.remote.prepare(kind, state);
      // Claim the create exactly once after preparation, even across windows.
      await this.update((current) => {
        if (
          current.runs[kind]?.token !== token ||
          current.runs[kind]?.phase !== "preparing"
        )
          throw new ApiError(
            409,
            t(
              "Another window is generating this content. Refresh to continue.",
            ),
          );
        Object.assign(current.runs[kind]!, { phase: "creating", prompt });
      });
      try {
        const session = await this.remote.create(token);
        await this.patch(kind, token, {
          phase: "ready",
          session_id: validSession(session.id),
        });
      } catch (error) {
        if (rejected(error))
          await this.patch(kind, token, {
            phase: "failed",
            error: (error as Error).message,
          });
        throw error;
      }
      run = (await this.state()).runs[kind]!;
    }
    if (run!.phase !== "ready") {
      if (["creating", "sending"].includes(run!.phase))
        throw new ApiError(
          409,
          t(
            "Submission is unconfirmed. Refresh to check its result; no duplicate was sent.",
          ),
        );
      return;
    }
    await this.update((current) => {
      if (
        current.runs[kind]?.token !== token ||
        current.runs[kind]?.phase !== "ready"
      )
        throw new ApiError(
          409,
          t("Another window submitted this generation. Refresh to see it."),
        );
      current.runs[kind]!.phase = "sending";
    });
    try {
      await this.remote.send(run!.session_id!, {
        id: run!.event_id,
        type: "user.message",
        content: [{ type: "text", text: run!.prompt! }],
      });
      await this.patch(kind, token, { phase: "running" });
    } catch (error) {
      if (rejected(error))
        await this.patch(kind, token, {
          phase: "failed",
          error: (error as Error).message,
        });
      throw error;
    }
  }
}
