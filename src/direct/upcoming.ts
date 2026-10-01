import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import { uuid } from "../../shared/crypto";
import { checkInPolicy } from "../../shared/checkin";
import {
  deliveredOccurrences,
  dueOccurrence,
  isReminderPrompt,
  reminderBatch,
  parseUpcoming,
  reminderPrompt,
  serializeUpcoming,
  type UpcomingItem,
} from "../../shared/upcoming";
import {
  pendingCustomTools,
  pendingPermissions,
  type AgentEvent,
  type Session,
} from "../../shared/types";
import { InitiationLog, type InitiationRecord, type Send } from "./initiations";
import type { LocalDatabase } from "./storage";

// `since` is when this device started delivering, so a new device does not
// replay occurrences another device may already have delivered. `delivered`
// holds the latest occurrence handed to MA for each item.
export type UpcomingState = {
  since?: number;
  delivered: Record<string, number>;
  records: InitiationRecord[];
};
type Revisioned = { content: string; revision: string };
type Remote = {
  main(): Promise<Session | undefined>;
  history(session: string): Promise<AgentEvent[]>;
  send: Send;
};

// Upcoming items live in MA memory; delivery is device-local. Each due
// occurrence is claimed before it is sent and never sent again, even when
// the result is ambiguous or rejected.
export class DirectUpcoming extends InitiationLog<UpcomingState> {
  private job?: Promise<InitiationRecord | undefined>;
  private writes = Promise.resolve();
  constructor(
    owner: string,
    db: LocalDatabase,
    private identity: {
      upcomingDocument(): Promise<Revisioned>;
      saveUpcomingDocument(
        content: string,
        revision: string,
      ): Promise<Revisioned>;
    },
    private remote: Remote,
    private now = () => Date.now(),
  ) {
    super(
      `${owner}:upcoming:v1`,
      db,
      { delivered: {}, records: [] },
      "reminder",
      "The reminder is unconfirmed. Refresh history; it will not be sent again.",
      isReminderPrompt,
    );
  }
  async list() {
    const document = await this.identity.upcomingDocument();
    return {
      items: parseUpcoming(document.content),
      revision: document.revision,
    };
  }
  // Pausing, resuming, and deleting rewrite UPCOMING.md with a revision check.
  change(id: string, action: "pause" | "resume" | "delete", revision: string) {
    const result = this.writes.then(async () => {
      const document = await this.identity.upcomingDocument();
      if (document.revision !== revision)
        throw new ApiError(
          409,
          t("Upcoming items changed. Refresh and review them before saving."),
        );
      const items = parseUpcoming(document.content);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new ApiError(404, t("This item no longer exists."));
      const next: UpcomingItem[] =
        action === "delete"
          ? items.filter((item) => item.id !== id)
          : items.map((item, i) =>
              i === index
                ? {
                    ...item,
                    status: action === "pause" ? "paused" : "active",
                    updated_at: new Date(this.now()).toISOString(),
                  }
                : item,
            );
      const saved = await this.identity.saveUpcomingDocument(
        serializeUpcoming(next),
        document.revision,
      );
      return { items: parseUpcoming(saved.content), revision: saved.revision };
    });
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  start(language: string): Promise<InitiationRecord | undefined> {
    if (this.job) return this.job;
    this.job = this.run(language).finally(() => {
      this.job = undefined;
    });
    return this.job;
  }
  private async run(language: string) {
    const now = this.now();
    let state = await this.db.update<UpcomingState>(this.key, (old) => {
      const current = old ?? this.empty;
      return current.since === undefined ? { ...current, since: now } : current;
    });
    const dueNow = (items: UpcomingItem[]) =>
      items.flatMap((item) => {
        const at = dueOccurrence(
          item,
          Math.max(state.since ?? now, state.delivered[item.id] ?? 0),
          now,
        );
        return at === undefined ? [] : [{ item, at }];
      });
    // Reading the schedule is cheap; history is read only when something is due
    // or an earlier delivery still needs confirming.
    const unresolved = state.records.filter(
      (record) =>
        record.phase === "sending" ||
        (record.phase === "unconfirmed" && now - record.at < 86400000),
    );
    if (!unresolved.length && !dueNow((await this.list()).items).length)
      return undefined;
    const main = await this.remote.main();
    for (const session of new Set(unresolved.map((record) => record.session)))
      if (session !== main?.id)
        await this.reconcile(session, await this.remote.history(session), true);
    if (!main) return undefined;
    const history = await this.remote.history(main.id);
    await this.reconcile(main.id, history, true);
    state = await this.state();
    // A session waiting on an approval or a tool result is waiting on the
    // person; the reminder stays due until it is free.
    if (
      main.status !== "idle" ||
      pendingPermissions(history).length ||
      pendingCustomTools(history).length ||
      state.records.some((record) => record.phase === "sending")
    )
      return undefined;
    // Another device open at the same time may already have delivered it;
    // record that here so it is not looked up again.
    const elsewhere = deliveredOccurrences(history);
    const candidates = dueNow((await this.list()).items);
    const seen = candidates.filter(({ item, at }) =>
      elsewhere.has(`${item.id}@${at}`),
    );
    if (seen.length)
      await this.db.update<UpcomingState>(this.key, (old) => {
        const current = old ?? this.empty;
        const delivered = { ...current.delivered };
        for (const { item, at } of seen)
          delivered[item.id] = Math.max(delivered[item.id] ?? 0, at);
        return { ...current, delivered };
      });
    const due = candidates
      .filter((entry) => !seen.includes(entry))
      .slice(0, reminderBatch);
    if (!due.length) return undefined;
    const latest = state.records.at(-1)?.eventId;
    const record: InitiationRecord = {
      phase: "sending",
      session: main.id,
      eventId: `evt-${uuid()}`,
      text: reminderPrompt(language, new Date(now), due),
      at: now,
    };
    let claimed = false;
    await this.db.update<UpcomingState>(this.key, (old) => {
      const current = old ?? this.empty;
      if (current.records.at(-1)?.eventId !== latest) return current;
      if (due.some(({ item, at }) => (current.delivered[item.id] ?? 0) >= at))
        return current;
      claimed = true;
      const delivered = { ...current.delivered };
      for (const { item, at } of due) delivered[item.id] = at;
      return {
        ...current,
        delivered,
        records: [...current.records, record].slice(-checkInPolicy.retained),
      };
    });
    if (!claimed) return undefined;
    return this.deliver(record, this.remote.send, this.remote.history);
  }
}
