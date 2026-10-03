import { uuid } from "../../shared/crypto";
import {
  checkInDue,
  checkInPolicy,
  checkInPrompt,
  isCheckInPrompt,
  type CheckInRecord,
} from "../../shared/checkin";
import { isGoalFollowUpPrompt } from "../../shared/goal-followup";
import { localDay } from "../../shared/proactive";
import type { AgentEvent, Session } from "../../shared/types";
import { InitiationLog, type Claim, type Send } from "./initiations";
import type { LocalDatabase } from "./storage";

// `elsewhere` is a local date whose check-in another device or the service
// claimed, so this device does not ask the service again that day.
export type CheckInState = {
  enabled: boolean;
  records: CheckInRecord[];
  elsewhere?: string;
};
type Remote = {
  // The current main conversation, if one exists; never creates one.
  main(): Promise<Session | undefined>;
  history(session: string): Promise<AgentEvent[]>;
  send: Send;
  // With an Open Muse account, the day's check-in is claimed with the service
  // first; local mode has no claim.
  claim?: Claim;
};

// At most one check-in per quiet period and local day for each device-local
// identity. Claims are transactional; an ambiguous send is reconciled by exact
// ID and text, never by sending again.
export class DirectCheckIn extends InitiationLog<CheckInState> {
  private job?: Promise<CheckInRecord | undefined>;
  constructor(
    owner: string,
    db: LocalDatabase,
    private remote: Remote,
    private now = () => Date.now(),
  ) {
    super(
      `${owner}:checkin:v1`,
      db,
      { enabled: true, records: [] },
      "checkin",
      "The check-in is unconfirmed. Refresh history; it will not be sent again.",
      // A goal follow-up the service sent is shown and hidden like a check-in.
      (text) => isCheckInPrompt(text) || isGoalFollowUpPrompt(text),
    );
  }
  setEnabled(enabled: boolean) {
    return this.db.update<CheckInState>(this.key, (old) => ({
      ...(old ?? this.empty),
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
    const day = localDay(now);
    if (
      state.elsewhere === day ||
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
      const current = old ?? this.empty;
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
    if (this.remote.claim) {
      // Only the device or service that claims the day first checks in. When
      // the service cannot confirm the claim, nothing is sent.
      let won = false;
      try {
        won = await this.remote.claim("checkin", day, main.id);
      } catch {
        await this.withdraw(record.eventId);
        return undefined;
      }
      if (!won) {
        await this.withdraw(record.eventId);
        await this.db.update<CheckInState>(this.key, (old) => ({
          ...(old ?? this.empty),
          elsewhere: day,
        }));
        return undefined;
      }
    }
    return this.deliver(record, this.remote.send, this.remote.history);
  }
}
