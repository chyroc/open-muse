-- One claim per app-generated message in an account's main chat (a check-in,
-- an Upcoming occurrence, or a goal follow-up). The first claimant, an app or
-- the service, wins and the others send nothing. Claims expire and are pruned.
CREATE TABLE proactive_claims (
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checkin', 'reminder', 'goal')),
  claim_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claimant TEXT NOT NULL CHECK (claimant IN ('app', 'service')),
  claim_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, kind, claim_key)
);
CREATE INDEX proactive_claims_expiry ON proactive_claims(expires_at);
CREATE INDEX proactive_claims_owner ON proactive_claims(owner_id, kind, created_at);
-- Check-ins and goal follow-ups while the apps are closed. Both are off by
-- default, need delivery while closed, and use the person's time zone.
ALTER TABLE upcoming_targets ADD COLUMN checkins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upcoming_targets ADD COLUMN goal_followups INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upcoming_targets ADD COLUMN time_zone TEXT;
-- The kind of each message the service sent to the main chat.
ALTER TABLE upcoming_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'reminder';
