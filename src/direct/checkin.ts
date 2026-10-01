import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import { uuid } from "../../shared/crypto";
import {
  checkInDue,
  checkInPolicy,
  checkInPrompt,
  type CheckInRecord,
} from "../../shared/checkin";
import {
  eventText,
  type AgentEvent,
  type Page,
  type Session,
} from "../../shared/types";
import type { LocalDatabase } from "./storage";

export type CheckInState = { enabled: boolean; records: CheckInRecord[] };
type Remote = {
  // The current main conversation, if one exists; never creates one.
  main(): Promise<Session | undefined>;
  history(session: string): Promise<AgentEvent[]>;
  send(
    session: string,
    text: string,
    eventId: string,
  ): Promise<Page<AgentEvent>>;
};

const empty: CheckInState = { enabled: true, records: [] };

// At most one check-in per quiet period and local day for each device-local
// identity. Claims are transactional; an ambiguous send is reconciled by exact
// ID and text, never by sending again.
export class DirectCheckIn {
  private key: string;
  private job?: Promise<CheckInRecord | undefined>;
  constructor(
    owner: string,
    private db: LocalDatabase,
    private remote: Remote,
    private now = () => Date.now(),
  ) {
    this.key = `${owner}:checkin:v1`;
  }
  async state(): Promise<CheckInState> {
    return (await this.db.get<CheckInState>(this.key)) ?? empty;
  }
  setEnabled(enabled: boolean) {
    return this.db.update<CheckInState>(this.key, (old) => ({
      ...(old ?? empty),
      enabled,
    }));
  }
  start(language: string): Promise<CheckInRecord | undefined> {
    if (this.job) return this.job;
    this.job = this.run(language).finally(() => {
      this.job = undefined;
    });
    return this.job;
  }
  private async run(language: string) {
    let state = await this.state();
    if (!state.enabled) return undefined;
    const main = await this.remote.main();
    const unresolved = state.records.filter(
      (record) => record.phase === "sending" || record.phase === "unconfirmed",
    );
    for (const session of new Set(unresolved.map((record) => record.session)))
      if (session !== main?.id)
        await this.reconcile(session, await this.remote.history(session), true);
    if (!main) return undefined;
    const history = await this.remote.history(main.id);
    await this.reconcile(main.id, history, true);
    state = await this.state();
    const now = this.now();
    if (
      !checkInDue({
        enabled: state.enabled,
        now,
        status: main.status,
        history,
        records: state.records,
      })
    )
      return undefined;
    const latest = state.records.at(-1)?.eventId;
    const record: CheckInRecord = {
      phase: "sending",
      session: main.id,
      eventId: `evt-${uuid()}`,
      text: checkInPrompt(language, new Date(now)),
      at: now,
    };
    let claimed = false;
    await this.db.update<CheckInState>(this.key, (old) => {
      const current = old ?? empty;
      // Another view claimed or the user turned check-ins off meanwhile.
      if (!current.enabled || current.records.at(-1)?.eventId !== latest)
        return current;
      claimed = true;
      return {
        ...current,
        records: [...current.records, record].slice(-checkInPolicy.retained),
      };
    });
    if (!claimed) return undefined;
    try {
      const result = await this.remote.send(
        record.session,
        record.text,
        record.eventId,
      );
      await this.reconcile(record.session, result.data ?? []);
      if ((await this.find(record.eventId))?.phase !== "confirmed")
        await this.reconcile(
          record.session,
          await this.remote.history(record.session),
        );
      if ((await this.find(record.eventId))?.phase !== "confirmed")
        throw new ApiError(
          502,
          t(
            "The check-in is unconfirmed. Refresh history; it will not be sent again.",
          ),
        );
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
  private async find(eventId: string) {
    return (await this.state()).records.find(
      (record) => record.eventId === eventId,
    );
  }
  private patch(
    eventId: string,
    change: (record: CheckInRecord) => CheckInRecord,
  ) {
    return this.db.update<CheckInState>(this.key, (old) => {
      const current = old ?? empty;
      return {
        ...current,
        records: current.records.map((record) =>
          record.eventId === eventId ? change(record) : record,
        ),
      };
    });
  }
  // Confirms initiations found in history and records their replies. With
  // `settle`, a send that never reached history is no longer treated as in
  // flight; it still blocks a new check-in until the quiet gap has passed.
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
    return records.some(
      (record) =>
        record.session === session &&
        record.eventId === event.id &&
        eventText(event) === record.text,
    )
      ? { ...event, app_initiation: "checkin" }
      : event;
  }
}
