import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import { uuid } from "../../shared/crypto";
import { welcomePrompt } from "../../shared/welcome";
import {
  eventText,
  type AgentEvent,
  type Page,
  type Session,
} from "../../shared/types";
import type { LocalDatabase } from "./storage";

export type WelcomeState =
  | { phase: "skipped" }
  | { phase: "preparing"; language: string }
  | {
      phase: "sending" | "unconfirmed" | "confirmed" | "rejected";
      session: string;
      eventId: string;
      text: string;
      replyId?: string;
    };
type Remote = {
  eligible(): Promise<boolean>;
  open(): Promise<Session>;
  history(session: string): Promise<AgentEvent[]>;
  send(
    session: string,
    text: string,
    eventId: string,
  ): Promise<Page<AgentEvent>>;
};

// One first-run initiation per device-local identity. Claims are transactional;
// ambiguous requests are reconciled by exact ID and text, never POST retries.
export class DirectWelcome {
  private key: string;
  private job?: Promise<WelcomeState>;
  constructor(
    owner: string,
    private db: LocalDatabase,
    private remote: Remote,
  ) {
    this.key = `${owner}:welcome:v1`;
  }
  state() {
    return this.db.get<WelcomeState>(this.key);
  }
  start(language: string, retry = false): Promise<WelcomeState> {
    if (this.job) return this.job;
    this.job = this.run(language, retry).finally(() => {
      this.job = undefined;
    });
    return this.job;
  }
  private async run(language: string, retry: boolean): Promise<WelcomeState> {
    let state = await this.state();
    if (state && "session" in state) {
      await this.reconcile(
        state.session,
        await this.remote.history(state.session),
      );
      state = (await this.state())!;
      if (state.phase !== "rejected" || !retry) return state;
      // A definitive rejection permits a new explicit attempt, not an auto retry.
      await this.db.update<WelcomeState>(this.key, (old) => {
        if (old?.phase !== "rejected")
          throw new ApiError(
            409,
            t("Welcome state changed. Refresh before continuing."),
          );
        return { phase: "preparing", language };
      });
    } else if (state?.phase === "skipped") return state;
    else if (state?.phase === "preparing" && !retry) return state;
    else if (!state) {
      if (!(await this.remote.eligible())) {
        return this.db.update<WelcomeState>(
          this.key,
          (old) => old ?? { phase: "skipped" },
        );
      }
      let claimed = false;
      state = await this.db.update<WelcomeState>(this.key, (old) => {
        if (old) return old;
        claimed = true;
        return { phase: "preparing", language };
      });
      if (!claimed) return state;
    }
    const session = await this.remote.open();
    const history = await this.remote.history(session.id);
    // A typed message or another view can get here first. Never inject a welcome
    // after substantive conversation, or into a running/ended session.
    if (
      session.status !== "idle" ||
      history.some((event) =>
        ["user.message", "agent.message"].includes(event.type),
      )
    ) {
      return this.db.update<WelcomeState>(this.key, (old) =>
        old?.phase === "preparing" ? { phase: "skipped" } : old!,
      );
    }
    const preparing = await this.state();
    const record: WelcomeState = {
      phase: "sending",
      session: session.id,
      eventId: `evt-${uuid()}`,
      text: welcomePrompt(
        preparing?.phase === "preparing" ? preparing.language : language,
      ),
    };
    await this.db.update<WelcomeState>(this.key, (old) => {
      if (old?.phase !== "preparing")
        throw new ApiError(
          409,
          t("Another view is starting this conversation. Refresh its history."),
        );
      return record;
    });
    try {
      const result = await this.remote.send(
        record.session,
        record.text,
        record.eventId,
      );
      await this.reconcile(record.session, result.data ?? []);
      if ((await this.state())?.phase !== "confirmed")
        await this.reconcile(
          record.session,
          await this.remote.history(record.session),
        );
      if ((await this.state())?.phase !== "confirmed")
        throw new ApiError(
          502,
          t(
            "The welcome request is unconfirmed. Refresh history; it will not be sent again.",
          ),
        );
      return (await this.state())!;
    } catch (error) {
      const rejected =
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status);
      await this.db.update<WelcomeState>(this.key, (old) => {
        if (
          old &&
          "eventId" in old &&
          old.eventId === record.eventId &&
          old.phase !== "confirmed"
        )
          return { ...old, phase: rejected ? "rejected" : "unconfirmed" };
        return old!;
      });
      throw error;
    }
  }
  async reconcile(session: string, history: AgentEvent[]) {
    const state = await this.state();
    if (!state || !("eventId" in state) || state.session !== session) return;
    const at = history.findIndex(
      (event) =>
        event.id === state.eventId &&
        event.type === "user.message" &&
        eventText(event) === state.text,
    );
    if (at < 0) return;
    let replyId = state.replyId;
    for (const event of history.slice(at + 1)) {
      if (event.type === "user.message") break;
      if (event.type === "agent.message") {
        replyId = event.id;
        break;
      }
    }
    await this.db.update<WelcomeState>(this.key, (old) =>
      old && "eventId" in old && old.eventId === state.eventId
        ? { ...old, phase: "confirmed", ...(replyId ? { replyId } : {}) }
        : old!,
    );
  }
  async annotate(session: string, event: AgentEvent): Promise<AgentEvent> {
    const state = await this.state();
    if (!state || !("eventId" in state) || state.session !== session)
      return event;
    if (
      event.id === state.eventId &&
      event.type === "user.message" &&
      eventText(event) === state.text
    )
      return { ...event, app_initiation: "welcome" };
    if (event.type === "agent.message" && event.id === state.replyId)
      return { ...event, welcome_reply: true };
    return event;
  }
}
