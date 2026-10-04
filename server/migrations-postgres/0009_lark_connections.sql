-- The account's Lark (Feishu) connection, set up by the Open Muse service:
-- the app it registered or the person chose, the person's user token and
-- refresh token, and any setup step in progress. Sealed with the account.
-- Sandboxes receive only a short-lived user access token.
CREATE TABLE lark_connections (
  owner_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL CHECK (revision > 0),
  encrypted TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
