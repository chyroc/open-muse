-- Single-use nonces of signed external scheduler triggers, kept only for the
-- accepted clock-skew window.
CREATE TABLE scheduler_triggers (
  nonce TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX scheduler_triggers_received ON scheduler_triggers(received_at);
