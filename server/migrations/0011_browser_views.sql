-- Live views of an account's cloud browser: the latest sealed frame and the
-- person's pending input, relayed between the app and a helper in the MA
-- sandbox. The sandbox's token is stored only as a hash. Views expire.
CREATE TABLE browser_views (
  view_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  frame_seq INTEGER NOT NULL DEFAULT 0,
  frame TEXT,
  frame_at INTEGER,
  input_seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX browser_views_owner ON browser_views(owner_id);
CREATE TABLE browser_inputs (
  view_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (view_id, seq)
);
