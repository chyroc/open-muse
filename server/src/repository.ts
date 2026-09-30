import type {
  BackgroundPhase,
  BackgroundRun,
  BackgroundSchedule,
  BackgroundPost,
} from "../../shared/background";
import type { InspirationContent } from "../../shared/inspiration";
import { HttpError } from "./env";
import {
  DAILY_RUN_LIMIT,
  nextDaily,
  POLL_INTERVAL,
  RUN_DEADLINE,
} from "./schedule";

export interface Run extends BackgroundRun {
  owner_id: string;
  marker: string;
  event_id: string;
  prompt: string | null;
  connection_hash: string | null;
  lease_token: string | null;
  lease_until: number | null;
  next_check_at: number;
  deadline_at: number;
}
const summary = "id, phase, session_id, error, created_at, scheduled_for";
export class Repository {
  constructor(
    readonly db: D1Database,
    readonly owner: string,
  ) {}
  async schedule(): Promise<BackgroundSchedule> {
    const row = await this.db
      .prepare(
        "SELECT enabled, timezone, local_time, next_run_at, revision FROM schedules WHERE owner_id=?",
      )
      .bind(this.owner)
      .first<BackgroundSchedule>();
    return row
      ? { ...row, enabled: Boolean(row.enabled) }
      : {
          enabled: false,
          timezone: "UTC",
          local_time: "09:00",
          next_run_at: null,
          revision: 0,
        };
  }
  async saveSchedule(
    input: Omit<BackgroundSchedule, "next_run_at">,
    now: number,
  ) {
    const next = input.enabled
      ? nextDaily(now, input.timezone, input.local_time)
      : null;
    // Compare-and-swap also protects simultaneous first-time configuration.
    const out = await this.db
      .prepare(
        `INSERT INTO schedules(owner_id,enabled,timezone,local_time,next_run_at,revision,updated_at,consent_at)
      SELECT ?,?,?,?,?,1,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM schedules WHERE owner_id=?)
      ON CONFLICT(owner_id) DO UPDATE SET enabled=excluded.enabled,timezone=excluded.timezone,local_time=excluded.local_time,
      next_run_at=excluded.next_run_at,revision=schedules.revision+1,updated_at=excluded.updated_at,
      consent_at=CASE WHEN excluded.enabled=1 THEN excluded.consent_at ELSE schedules.consent_at END
      WHERE schedules.revision=?`,
      )
      .bind(
        this.owner,
        +input.enabled,
        input.timezone,
        input.local_time,
        next,
        now,
        input.enabled ? now : null,
        input.revision,
        this.owner,
        input.revision,
      )
      .run();
    if (!out.meta.changes)
      throw new HttpError(409, "The schedule changed. Refresh before saving.");
    return this.schedule();
  }
  async enqueue(
    key: string,
    scheduledFor: number,
    now: number,
    automatic = false,
  ) {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO runs(id,owner_id,request_key,scheduled_for,phase,marker,event_id,next_check_at,created_at,updated_at,deadline_at)
      SELECT ?,?,?,?,'queued',?,?,?,?,?,?
      WHERE (SELECT count(*) FROM runs WHERE owner_id=? AND created_at>?) < ?
      AND NOT EXISTS(SELECT 1 FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed'))
      AND (?=0 OR EXISTS(SELECT 1 FROM schedules WHERE owner_id=? AND enabled=1 AND next_run_at=?))`,
      )
      .bind(
        id,
        this.owner,
        key,
        scheduledFor,
        `open-muse-background-${id}`,
        `evt-${crypto.randomUUID()}`,
        now,
        now,
        now,
        now + RUN_DEADLINE,
        this.owner,
        now - 86400000,
        DAILY_RUN_LIMIT,
        this.owner,
        +automatic,
        this.owner,
        scheduledFor,
      )
      .run();
    const row = await this.db
      .prepare(`SELECT ${summary} FROM runs WHERE owner_id=? AND request_key=?`)
      .bind(this.owner, key)
      .first<BackgroundRun>();
    if (!row)
      throw new HttpError(
        409,
        "Another run is active, the schedule changed, or the rolling daily limit was reached.",
      );
    return row;
  }
  async dispatchDue(now: number) {
    const s = await this.schedule();
    if (!s.enabled || s.next_run_at === null || s.next_run_at > now) return;
    try {
      await this.enqueue(
        `scheduled:${s.next_run_at}`,
        s.next_run_at,
        now,
        true,
      );
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 409)) throw e;
    }
    // Skip missed occurrences instead of generating a catch-up burst. Avoid the
    // second occurrence of an ambiguous local hour when advancing this schedule.
    const next = nextDaily(now + 3 * 3600000, s.timezone, s.local_time);
    await this.db
      .prepare(
        "UPDATE schedules SET next_run_at=? WHERE owner_id=? AND enabled=1 AND revision=? AND next_run_at=?",
      )
      .bind(next, this.owner, s.revision, s.next_run_at)
      .run();
  }
  async runs() {
    return (
      await this.db
        .prepare(
          `SELECT ${summary} FROM runs WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 30`,
        )
        .bind(this.owner)
        .all<BackgroundRun>()
    ).results;
  }
  async feed(after = 0) {
    const rows = (
      await this.db
        .prepare(
          "SELECT * FROM feed_items WHERE owner_id=? AND sequence>? ORDER BY sequence LIMIT 100",
        )
        .bind(this.owner, after)
        .all<{
          id: string;
          sequence: number;
          session_id: string;
          event_id: string;
          content: string;
          created_at: number;
        }>()
    ).results;
    const items: BackgroundPost[] = rows.map((r) => ({
      ...JSON.parse(r.content),
      id: r.id,
      sequence: r.sequence,
      session_id: r.session_id,
      event_id: r.event_id,
      created_at: r.created_at,
    }));
    return {
      items,
      cursor: rows.at(-1)?.sequence ?? after,
      hasMore: rows.length === 100,
    };
  }
  async claim(now: number) {
    const token = crypto.randomUUID();
    return this.db
      .prepare(
        `UPDATE runs SET lease_token=?,lease_until=? WHERE id=(
      SELECT id FROM runs WHERE owner_id=? AND phase NOT IN ('complete','failed','needs_attention')
      AND next_check_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1
    ) RETURNING *`,
      )
      .bind(token, now + 120000, this.owner, now, now)
      .first<Run>();
  }
  async transition(
    run: Run,
    from: BackgroundPhase,
    patch: {
      phase: BackgroundPhase;
      session_id?: string;
      prompt?: string;
      connection_hash?: string;
      error?: string | null;
    },
    now: number,
  ) {
    const entries = Object.entries(patch);
    if (patch.phase === "needs_attention") entries.push(["resume_phase", from]);
    const out = await this.db
      .prepare(
        `UPDATE runs SET ${entries.map(([k]) => `${k}=?`).join(",")},updated_at=? WHERE id=? AND owner_id=? AND phase=? AND lease_token=? AND lease_until>?`,
      )
      .bind(
        ...entries.map(([, v]) => v ?? null),
        now,
        run.id,
        this.owner,
        from,
        run.lease_token,
        now,
      )
      .run();
    if (!out.meta.changes)
      throw new HttpError(
        409,
        "The run lease changed; no further request was sent.",
      );
    Object.assign(run, patch);
  }
  async release(run: Run, now: number, error: string | null = null) {
    await this.db
      .prepare(
        "UPDATE runs SET lease_token=NULL,lease_until=NULL,next_check_at=?,error=?,updated_at=? WHERE id=? AND owner_id=? AND lease_token=?",
      )
      .bind(
        now + POLL_INTERVAL,
        error,
        now,
        run.id,
        this.owner,
        run.lease_token,
      )
      .run();
  }
  async finish(
    run: Run,
    eventId: string,
    items: InspirationContent[],
    now: number,
  ) {
    const inserts = items.map((item, i) =>
      this.db
        .prepare(
          `INSERT OR IGNORE INTO feed_items(id,owner_id,run_id,session_id,event_id,position,content,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND phase IN ('sending','running'))`,
        )
        .bind(
          `${run.id}:${i}`,
          this.owner,
          run.id,
          run.session_id,
          eventId,
          i,
          JSON.stringify(item),
          now,
          run.id,
          this.owner,
          run.lease_token,
          now,
        ),
    );
    await this.db.batch([
      ...inserts,
      this.db
        .prepare(
          "UPDATE runs SET phase='complete',prompt=NULL,error=NULL,updated_at=? WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND phase IN ('sending','running')",
        )
        .bind(now, run.id, this.owner, run.lease_token, now),
    ]);
  }
  async recheck(id: string, now: number) {
    const out = await this.db
      .prepare(
        "UPDATE runs SET phase=resume_phase,resume_phase=NULL,deadline_at=?,next_check_at=?,error=NULL WHERE id=? AND owner_id=? AND phase='needs_attention' AND resume_phase IS NOT NULL AND (lease_until IS NULL OR lease_until<?)",
      )
      .bind(now + RUN_DEADLINE, now, id, this.owner, now)
      .run();
    if (!out.meta.changes)
      throw new HttpError(409, "This run is not ready for review.");
  }
}
