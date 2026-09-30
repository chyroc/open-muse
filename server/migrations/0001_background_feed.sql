CREATE TABLE schedules (
  owner_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  local_time TEXT NOT NULL DEFAULT '09:00',
  next_run_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  consent_at INTEGER
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'queued', 'creating', 'ready', 'sending', 'running',
    'complete', 'failed', 'needs_attention'
  )),
  marker TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  prompt TEXT,
  error TEXT,
  lease_token TEXT,
  lease_until INTEGER,
  next_check_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, request_key)
);
CREATE INDEX runs_due ON runs(next_check_at, phase);
CREATE INDEX runs_owner ON runs(owner_id, created_at);
CREATE UNIQUE INDEX runs_one_active ON runs(owner_id)
  WHERE phase NOT IN ('complete', 'failed');

CREATE TABLE feed_items (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, session_id, event_id, position)
);
CREATE INDEX feed_owner ON feed_items(owner_id, sequence);
