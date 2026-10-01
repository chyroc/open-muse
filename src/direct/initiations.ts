import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import type { CheckInRecord } from "../../shared/checkin";
import { eventText, type AgentEvent, type Page } from "../../shared/types";
import type { LocalDatabase } from "./storage";

export type InitiationRecord = CheckInRecord;
export type InitiationState = { records: InitiationRecord[] };
export type Send = (
  session: string,
  text: string,
  eventId: string,
) => Promise<Page<AgentEvent>>;

// A device-local log of app-generated messages in the main chat. Each one is
// claimed before sending, confirmed by exact ID and text from history, and
// never sent again when the result is ambiguous.
export class InitiationLog<S extends InitiationState> {
  constructor(
    protected key: string,
    protected db: LocalDatabase,
    protected empty: S,
    private kind: NonNullable<AgentEvent["app_initiation"]>,
    private unconfirmed: string,
    // Recognizes the app's own prompt text, including one sent by another
    // device or one whose record has rolled out of this log.
    private matches: (text: string) => boolean,
  ) {}
  async state(): Promise<S> {
    return (await this.db.get<S>(this.key)) ?? this.empty;
  }
  protected find(eventId: string) {
    return this.state().then(({ records }) =>
      records.find((record) => record.eventId === eventId),
    );
  }
  protected patch(
    eventId: string,
    change: (record: InitiationRecord) => InitiationRecord,
  ) {
    return this.db.update<S>(this.key, (old) => {
      const current = old ?? this.empty;
      return {
        ...current,
        records: current.records.map((record) =>
          record.eventId === eventId ? change(record) : record,
        ),
      };
    });
  }
  // Sends a record already claimed in the log and confirms it from history.
  protected async deliver(
    record: InitiationRecord,
    send: Send,
    history: (session: string) => Promise<AgentEvent[]>,
  ) {
    try {
      const result = await send(record.session, record.text, record.eventId);
      await this.reconcile(record.session, result.data ?? []);
      if ((await this.find(record.eventId))?.phase !== "confirmed")
        await this.reconcile(record.session, await history(record.session));
      if ((await this.find(record.eventId))?.phase !== "confirmed")
        throw new ApiError(502, t(this.unconfirmed));
      return this.find(record.eventId);
    } catch (error) {
      const rejected =
        error instanceof ApiError &&
        [400, 401, 403, 404, 409, 413, 429].includes(error.status);
      await this.patch(record.eventId, (old) =>
        old.phase === "confirmed"
          ? old
          : { ...old, phase: rejected ? "rejected" : "unconfirmed" },
      );
      throw error;
    }
  }
  // Confirms initiations found in history and records their replies. With
  // `settle`, a send that never reached history is no longer treated as in
  // flight; callers still decide whether a new initiation is allowed.
  async reconcile(session: string, history: AgentEvent[], settle = false) {
    const state = await this.state();
    for (const record of state.records) {
      if (record.session !== session) continue;
      const at = history.findIndex(
        (event) =>
          event.id === record.eventId &&
          event.type === "user.message" &&
          eventText(event) === record.text,
      );
      if (at < 0) {
        if (settle && record.phase === "sending")
          await this.patch(record.eventId, (old) =>
            old.phase === "sending" ? { ...old, phase: "unconfirmed" } : old,
          );
        continue;
      }
      let replyId = record.replyId;
      for (const event of history.slice(at + 1)) {
        if (event.type === "user.message") break;
        if (event.type === "agent.message" && eventText(event).trim()) {
          replyId = event.id;
          break;
        }
      }
      if (record.phase !== "confirmed" || replyId !== record.replyId)
        await this.patch(record.eventId, (old) => ({
          ...old,
          phase: "confirmed",
          ...(replyId ? { replyId } : {}),
        }));
    }
  }
  async annotate(session: string, event: AgentEvent): Promise<AgentEvent> {
    if (event.type !== "user.message") return event;
    const { records } = await this.state();
    const text = eventText(event);
    return this.matches(text) ||
      records.some(
        (record) =>
          record.session === session &&
          record.eventId === event.id &&
          text === record.text,
      )
      ? { ...event, app_initiation: this.kind }
      : event;
  }
}
