-- The account's Lark sign-in, kept so a new cloud environment starts signed
-- in: lark-cli's configuration and token store as the sandbox archived them,
-- sealed with the account. Sandboxes reach it only with a token the app
-- issued for one conversation. Tokens are stored as hashes and expire.
CREATE TABLE lark_states (
  owner_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL CHECK (revision > 0),
  encrypted TEXT,
  updated_at BIGINT NOT NULL
);
CREATE TABLE lark_tokens (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX lark_tokens_owner ON lark_tokens(owner_id, created_at);
