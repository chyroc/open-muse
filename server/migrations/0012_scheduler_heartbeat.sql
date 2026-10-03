-- One row recording the scheduler's progress, read by the public health check.
-- It keeps only times, a short failure code, and how many sealed values still
-- wait for the current encryption key. No error text, owner, or secret.
CREATE TABLE scheduler_heartbeat (
  id TEXT PRIMARY KEY CHECK (id = 'scheduler'),
  created_at INTEGER NOT NULL,
  last_tick_at INTEGER,
  last_failure_at INTEGER,
  last_failure_code TEXT,
  rewrap_pending INTEGER,
  rewrap_checked_at INTEGER
);
INSERT INTO scheduler_heartbeat(id,created_at)
VALUES ('scheduler', CAST(strftime('%s','now') AS INTEGER) * 1000);
