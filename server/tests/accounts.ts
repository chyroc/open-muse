import { vi } from "vitest";
import { seal } from "../src/connection";
import { supabaseOwner } from "../../shared/supabase-auth";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import type { Env } from "../src/env";
import type { BackgroundConfiguration } from "../../shared/background-connection";

// Open Muse account sessions for tests, verified by a fake Auth provider.
export const authOrigin = "https://auth.example.com";
export const anonKey = "sb_publishable_test_public_key_only";

export function accountEnv(DB: Env["DB"], extra: Partial<Env> = {}): Env {
  return {
    DB,
    SUPABASE_AUTH_URL: authOrigin,
    SUPABASE_ANON_KEY: anonKey,
    ...extra,
  };
}

// An opaque access token the fake provider resolves to `id`. Each device of
// the same user holds its own token.
export function session(id: string = crypto.randomUUID(), device = "first") {
  return {
    id,
    token: `test-session-${id}.${device}`,
    owner: supabaseOwner(authOrigin, id),
  };
}

// Answers `/auth/v1/user` for `session()` tokens (401 otherwise) and passes
// every other request to `next`.
export function withAuth(next?: typeof fetch) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== authOrigin) {
      if (!next) throw new Error(`Unexpected request to ${url.origin}`);
      return next(input, init);
    }
    const bearer = new Headers(init?.headers).get("Authorization") ?? "";
    const id = /^Bearer test-session-([0-9a-f-]{36})\.[\w-]+$/.exec(bearer)?.[1];
    return id
      ? Response.json({ id, is_anonymous: false })
      : Response.json({ message: "invalid" }, { status: 401 });
  });
}

export const workspaceKey = (config: BackgroundConfiguration, owner: string) =>
  accountWorkspaceKey(config.apiKey, config.project, owner);

// Gives `owner` what the account flow would have produced before binding
// background work: the stored key (revision 1), a recent verified request
// under the configured issuer, and the workspace resources recorded for it.
export async function seedAccount(
  env: Env,
  owner: string,
  config: BackgroundConfiguration,
  now = Date.now(),
) {
  const credential = { apiKey: config.apiKey, project: config.project };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO account_credentials(owner_id,revision,encrypted,updated_at,mutation_id,issuer,last_seen_at)
      VALUES(?,1,?,?,?,?,?)`,
    ).bind(
      owner,
      await seal(env, "open-muse-account-ark", owner, 1, credential),
      now,
      crypto.randomUUID(),
      authOrigin,
      now,
    ),
    ...(
      [
        ["agent", config.agentId],
        ["environment", config.environmentId],
        ["memory_store", config.memoryStoreId],
      ] as const
    ).map(([kind, id]) =>
      env.DB.prepare(
        "INSERT INTO account_resources(kind,resource_id,owner_id,claimed_at) VALUES(?,?,?,?)",
      ).bind(kind, id, owner, now),
    ),
  ]);
  return { credentialRevision: 1, workspaceKey: workspaceKey(config, owner) };
}

// A read-only Ark double. Each workspace is readable with its own key and
// carries the ownership label of the account it was created for.
export function arkWorkspaces(
  workspaces: { owner: string; config: BackgroundConfiguration }[],
  { tools = [] as unknown[] } = {},
) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const key = new Headers(init?.headers).get("Authorization");
    const path = new URL(String(input)).pathname;
    for (const { owner, config } of workspaces) {
      if (key !== `Bearer ${config.apiKey}`) continue;
      const metadata = {
        open_muse_workspace: workspaceKey(config, owner),
        open_muse_identity: workspaceKey(config, owner),
      };
      if (path.endsWith(`/agents/${config.agentId}`))
        return Response.json({
          id: config.agentId,
          version: config.agentVersion,
          tools,
          metadata,
        });
      if (path.endsWith(`/environments/${config.environmentId}`))
        return Response.json({ id: config.environmentId, metadata });
      if (path.endsWith(`/memory_stores/${config.memoryStoreId}`))
        return Response.json({ id: config.memoryStoreId, metadata });
    }
    return Response.json({}, { status: key ? 403 : 401 });
  });
}
