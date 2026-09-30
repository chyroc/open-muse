CREATE TABLE ark_connections (
  owner_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL
);
