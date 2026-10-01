-- Server delivery of an account's UPCOMING.md items into its main session.
CREATE TABLE upcoming_targets (
  owner_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  language TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  since INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'session_unavailable')),
  next_check_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX upcoming_targets_due ON upcoming_targets(enabled, state, next_check_at);
-- One message per delivery. Its event ID is persisted before it is sent.
CREATE TABLE upcoming_messages (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('sending', 'sent', 'unconfirmed', 'rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX upcoming_messages_owner ON upcoming_messages(owner_id, created_at);
-- Each occurrence is claimed once, before anything is sent, and never again.
CREATE TABLE upcoming_deliveries (
  owner_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  occurrence_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, item_id, occurrence_at)
);
CREATE INDEX upcoming_deliveries_event ON upcoming_deliveries(event_id);
