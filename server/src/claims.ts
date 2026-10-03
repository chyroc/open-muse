import { uuid } from "../../shared/crypto";
import {
  claimRetention,
  type ClaimInput,
  type ClaimKind,
  type ClaimResult,
} from "../../shared/proactive";
import { HttpError, type Env } from "./env";

// Cross-device claims for app-generated messages in an account's main chat.
// Each (owner, kind, key) is claimed at most once while the claim lives: the
// first insert wins by the table's primary key, so an app and the service, or
// two apps, never both send the same check-in, reminder, or goal follow-up.
// A claim records only the kind, a non-personal key, and the conversation.
const LIVE_LIMIT = 1000;

export class ProactiveClaims {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  // One claim attempt. Rows changed tells whether it won: a new row, or one
  // replacing an expired claim.
  statement(
    kind: ClaimKind,
    key: string,
    session: string,
    claimant: "app" | "service",
    claimId: string,
    now: number,
  ) {
    return this.env.DB.prepare(
      `INSERT INTO proactive_claims(owner_id,kind,claim_key,session_id,claimant,claim_id,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,kind,claim_key) DO UPDATE SET session_id=excluded.session_id,
        claimant=excluded.claimant,claim_id=excluded.claim_id,created_at=excluded.created_at,
        expires_at=excluded.expires_at
      WHERE proactive_claims.expires_at<=?`,
    ).bind(
      this.owner,
      kind,
      key,
      session,
      claimant,
      claimId,
      now,
      now + claimRetention,
      now,
    );
  }

  // Keys of `kind` this claim attempt holds, after a batch of statements.
  async held(kind: ClaimKind, claimId: string) {
    const rows = await this.env.DB.prepare(
      "SELECT claim_key FROM proactive_claims WHERE owner_id=? AND kind=? AND claim_id=?",
    )
      .bind(this.owner, kind, claimId)
      .all<{ claim_key: string }>();
    return new Set(rows.results.map((row) => row.claim_key));
  }

  // Live claims of `kind` made at or after `since`, newest first.
  async recent(kind: ClaimKind, since: number, now: number) {
    const rows = await this.env.DB.prepare(
      `SELECT claim_key,created_at FROM proactive_claims
      WHERE owner_id=? AND kind=? AND created_at>=? AND expires_at>?
      ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(this.owner, kind, since, now)
      .all<{ claim_key: string; created_at: number }>();
    return rows.results;
  }

  // An app's claim, from POST /v1/account/claims.
  async claim(input: ClaimInput, now = Date.now()): Promise<ClaimResult> {
    const live = await this.env.DB.prepare(
      "SELECT count(*) AS n FROM proactive_claims WHERE owner_id=? AND expires_at>?",
    )
      .bind(this.owner, now)
      .first<{ n: number }>();
    if (Number(live?.n ?? 0) >= LIVE_LIMIT)
      throw new HttpError(429, "Too many claims. Try again later.");
    const result = await this.statement(
      input.kind,
      input.key,
      input.session_id,
      "app",
      uuid(),
      now,
    ).run();
    if (result.meta.changes) return { claimed: true };
    const row = await this.env.DB.prepare(
      "SELECT claimant,created_at FROM proactive_claims WHERE owner_id=? AND kind=? AND claim_key=?",
    )
      .bind(this.owner, input.kind, input.key)
      .first<{ claimant: "app" | "service"; created_at: number }>();
    return {
      claimed: false,
      by: row?.claimant ?? "app",
      age_ms: Math.max(0, now - Number(row?.created_at ?? now)),
    };
  }
}

// Removes expired claims of every account; run on each scheduler tick.
export function pruneClaims(env: Env, now: number) {
  return env.DB.prepare("DELETE FROM proactive_claims WHERE expires_at<=?")
    .bind(now)
    .run();
}
