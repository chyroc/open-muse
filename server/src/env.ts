export interface Env {
  DB: D1Database;
  OWNER_ID: string;
  // Trusted device-token hash -> {ownerId, deviceLabel}. Never client-selected.
  DEVICE_TOKEN_HASHES?: string;
  // Auth-only trial. These are a fixed provider origin and a public anon key,
  // never a service-role key. Existing private-device enrollment is separate.
  SUPABASE_AUTH_URL?: string;
  SUPABASE_ANON_KEY?: string;
  ALLOWED_ORIGINS?: string;
  BACKGROUND_ENABLED?: string;
  // Worker secret: {"current":"v1","keys":{"v1":"<32-byte base64>"}}.
  // This keyring must never be stored in D1 or sent to clients.
  CREDENTIAL_ENCRYPTION_KEYS?: string;
  ARK_API_KEY?: string;
  ARK_PROJECT?: string;
  ARK_AGENT_ID?: string;
  ARK_AGENT_VERSION?: string;
  ARK_ENVIRONMENT_ID?: string;
  ARK_MEMORY_STORE_ID?: string;
  // Internal flag for a verified, uploaded app connection. Not client input.
  ARK_SESSION_OVERRIDES?: string;
}

export function backgroundReady(env: Env) {
  return (
    env.BACKGROUND_ENABLED === "true" &&
    Boolean(env.ARK_API_KEY) &&
    [env.ARK_AGENT_ID, env.ARK_ENVIRONMENT_ID, env.ARK_MEMORY_STORE_ID].every(
      (id) => /^[\w-]{1,200}$/.test(id ?? ""),
    ) &&
    /^[1-9]\d*$/.test(env.ARK_AGENT_VERSION ?? "")
  );
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    // Machine-readable reason clients may act on; never contains user data.
    public code?: string,
    public details?: string[],
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
