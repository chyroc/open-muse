import { base64url, hash } from "./browser";
import { seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";

// The account's Lark sign-in, carried from one cloud environment to the next.
// lark-cli keeps its app configuration and user token in the sandbox, and
// every conversation gets a fresh sandbox, so the toolbox archives that state
// after each lark-cli command that changed it and restores it in a new
// sandbox. The archive holds credentials: it is sealed with the account, and
// a sandbox reaches it only with a random token the app issued for one
// conversation, stored here as a hash, expiring after 30 days. The person can
// remove the saved sign-in from the app at any time.
const purpose = "open-muse-lark-state";
export const LARK_TOKEN_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const MAX_TOKENS = 50;
export const MAX_LARK_STATE = 1_000_000; // base64 characters

type StateRow = {
  revision: number;
  encrypted: string | null;
  updated_at: number;
};

async function row(env: Env, owner: string) {
  return env.DB.prepare(
    "SELECT revision,encrypted,updated_at FROM lark_states WHERE owner_id=?",
  )
    .bind(owner)
    .first<StateRow>();
}

// The app's side, through a verified account session.
export class LarkStates {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  // A token for one conversation's sandbox, returned once. Expired and the
  // oldest tokens beyond the limit are removed.
  async issue(now: number) {
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const expires = now + LARK_TOKEN_LIFETIME;
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO lark_tokens(token_hash,owner_id,created_at,expires_at) VALUES (?,?,?,?)",
      ).bind(await hash(token), this.owner, now, expires),
      this.env.DB.prepare(
        `DELETE FROM lark_tokens WHERE owner_id=? AND (expires_at<=? OR token_hash NOT IN
          (SELECT token_hash FROM lark_tokens WHERE owner_id=? ORDER BY created_at DESC LIMIT ${MAX_TOKENS}))`,
      ).bind(this.owner, now, this.owner),
    ]);
    return { token, expires_at: expires };
  }

  // Whether a sign-in is saved; never its content.
  async status() {
    const current = await row(this.env, this.owner);
    return current?.encrypted
      ? { saved: true, updated_at: current.updated_at }
      : { saved: false };
  }

  // Forgets the saved sign-in and every sandbox token.
  async remove() {
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM lark_tokens WHERE owner_id=?").bind(
        this.owner,
      ),
      this.env.DB.prepare("DELETE FROM lark_states WHERE owner_id=?").bind(
        this.owner,
      ),
      this.env.DB.prepare("DELETE FROM lark_connections WHERE owner_id=?").bind(
        this.owner,
      ),
    ]);
    return { saved: false as const };
  }
}

export async function tokenOwner(env: Env, token: string, now: number) {
  const found = token
    ? await env.DB.prepare(
        "SELECT owner_id,expires_at FROM lark_tokens WHERE token_hash=?",
      )
        .bind(await hash(token))
        .first<{ owner_id: string; expires_at: number }>()
    : null;
  // A wrong, removed, or expired token all look the same.
  if (!found || found.expires_at <= now)
    throw new HttpError(401, "This Lark sign-in token is not valid.");
  return found.owner_id;
}

// The sandbox's side: read the saved archive, or replace it at the revision
// it last read. A stale revision returns the current one so the sandbox can
// write again, since its copy is the newest sign-in it has.
export async function sandboxState(
  env: Env,
  token: string,
  method: string,
  input: Record<string, unknown> | undefined,
  now: number,
) {
  const owner = await tokenOwner(env, token, now);
  const current = await row(env, owner);
  if (method === "GET")
    return {
      revision: current?.revision ?? 0,
      state: current?.encrypted
        ? ((await unseal(
            env,
            purpose,
            owner,
            current.revision,
            current.encrypted,
          )) as string)
        : null,
    };
  const state = input?.state;
  const base = input?.base_revision;
  if (
    (state !== null &&
      (typeof state !== "string" ||
        !state.length ||
        state.length > MAX_LARK_STATE ||
        !/^[A-Za-z0-9+/=]+$/.test(state))) ||
    typeof base !== "number" ||
    !Number.isSafeInteger(base) ||
    base < 0 ||
    Object.keys(input ?? {}).some(
      (key) => !["state", "base_revision"].includes(key),
    )
  )
    throw new HttpError(
      400,
      "Send the Lark state as base64, or null, with the revision it replaces.",
    );
  const revision = base + 1;
  const encrypted =
    state === null ? null : await seal(env, purpose, owner, revision, state);
  const result =
    base === 0
      ? await env.DB.prepare(
          "INSERT INTO lark_states(owner_id,revision,encrypted,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO NOTHING",
        )
          .bind(owner, revision, encrypted, now)
          .run()
      : await env.DB.prepare(
          "UPDATE lark_states SET revision=?,encrypted=?,updated_at=? WHERE owner_id=? AND revision=?",
        )
          .bind(revision, encrypted, now, owner, base)
          .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      "The saved Lark sign-in changed; read it again.",
      "lark_state_changed",
    );
  return { revision };
}
