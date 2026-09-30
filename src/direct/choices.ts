import { ApiError } from "../../shared/ark";
import { digest, uuid } from "../../shared/crypto";
import {
  currentChoiceEvent,
  parseChoiceMessage,
  type ChoiceReply,
} from "../../shared/chat-choices";
import {
  eventText,
  type AgentEvent,
  type Page,
  type Session,
} from "../../shared/types";
import { LocalDatabase } from "./storage";

type Replies = Record<string, ChoiceReply>;
type Remote = {
  history(session: string): Promise<AgentEvent[]>;
  session(session: string): Promise<Session>;
  send(
    session: string,
    text: string,
    eventId: string,
  ): Promise<Page<AgentEvent>>;
};

// A selection is an ordinary MA user message. The durable event ID resolves
// uncertain results; neither reopening a widget nor polling repeats a POST.
export class DirectChoices {
  constructor(
    private owner: string,
    private db: LocalDatabase,
    private remote: Remote,
  ) {}
  private key(session: string) {
    return `${this.owner}:choices:${session}`;
  }
  async reply(session: string, question: string) {
    return (await this.db.get<Replies>(this.key(session)))?.[question];
  }
  async reconcile(session: string, history: AgentEvent[]) {
    const previous = await this.db.get<Replies>(this.key(session));
    if (!previous) return;
    const matching = (reply: ChoiceReply) =>
      history.some(
        (event) =>
          event.id === reply.eventId &&
          event.type === "user.message" &&
          eventText(event) === reply.label,
      );
    if (
      !Object.values(previous).some(
        (reply) => reply.state !== "confirmed" && matching(reply),
      )
    )
      return;
    await this.db.update<Replies>(this.key(session), (old) => {
      const records = old ?? {};
      for (const reply of Object.values(records))
        if (matching(reply)) reply.state = "confirmed";
      return records;
    });
  }
  async answer(
    session: string,
    question: string,
    option: string,
    revision: string,
  ) {
    const [history, remote] = await Promise.all([
      this.remote.history(session),
      this.remote.session(session),
    ]);
    await this.reconcile(session, history);
    const previous = await this.reply(session, question);
    if (previous && previous.state !== "rejected") {
      if (previous.state === "confirmed" && previous.optionId === option)
        return previous;
      throw new ApiError(
        409,
        previous.state === "confirmed"
          ? "This question has already been answered. Continue in the message field."
          : "The previous selection is unconfirmed. Refresh history before continuing; it will not be sent again.",
      );
    }
    const source = currentChoiceEvent(history);
    if (!source || source.id !== question || remote.status !== "idle")
      throw new ApiError(
        409,
        "This question is no longer awaiting an answer. Refresh history or continue in the message field.",
      );
    if (digest(eventText(source)) !== revision)
      throw new ApiError(
        409,
        "This question changed. Refresh and review its options before choosing.",
      );
    const choice = parseChoiceMessage(eventText(source)).choice!;
    const selected = choice.options.find((item) => item.id === option);
    if (!selected)
      throw new ApiError(400, "That option is not part of this question.");
    const reply: ChoiceReply = {
      eventId: `evt-${uuid()}`,
      optionId: selected.id,
      label: selected.label,
      state: "sending",
    };
    await this.db.update<Replies>(this.key(session), (old) => {
      const records = old ?? {};
      if (
        (records[question] && records[question].state !== "rejected") ||
        Object.values(records).some(
          (item) => item.state === "sending" || item.state === "unconfirmed",
        )
      )
        throw new ApiError(
          409,
          "Another selection is unconfirmed. Refresh history before continuing.",
        );
      return { ...records, [question]: reply };
    });
    try {
      const result = await this.remote.send(
        session,
        selected.label,
        reply.eventId,
      );
      await this.reconcile(session, result.data ?? []);
      if ((await this.reply(session, question))?.state !== "confirmed")
        await this.reconcile(session, await this.remote.history(session));
      const saved = await this.reply(session, question);
      if (saved?.state !== "confirmed")
        throw new Error(
          "The selection is unconfirmed. Refresh history; it will not be sent again.",
        );
      return saved;
    } catch (error) {
      const rejected =
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status);
      await this.db.update<Replies>(this.key(session), (old) => {
        const records = old ?? {};
        if (
          records[question]?.eventId === reply.eventId &&
          records[question].state !== "confirmed"
        )
          records[question].state = rejected ? "rejected" : "unconfirmed";
        return records;
      });
      throw error;
    }
  }
}
