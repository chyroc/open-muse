import type { Database } from "./database";
import { maProvider } from "../../shared/ma-provider";

export interface Env {
  DB: Database;
  // Open Muse account Auth: a fixed provider origin and a public anon key,
  // never a service-role key. Without them every request is refused.
  SUPABASE_AUTH_URL?: string;
  // The Managed Agents backend accounts' keys belong to: "ark" (default) or
  // "claude". It must match the apps' VITE_MUSE_MA_PROVIDER.
  MA_PROVIDER?: string;
  SUPABASE_ANON_KEY?: string;
  ALLOWED_ORIGINS?: string;
  BACKGROUND_ENABLED?: string;
  // "external" hands the schedule clock to a signed trigger (for example a
  // Volcengine veFaaS timer) and disables Workers Cron. Defaults to cron.
  SCHEDULER_SOURCE?: string;
  // Worker secret shared only with the external trigger; at least 256 bits.
  SCHEDULER_TRIGGER_SECRET?: string;
  // Worker secret: {"current":"v1","keys":{"v1":"<32-byte base64>"}}.
  // This keyring must never be stored in D1 or sent to clients.
  CREDENTIAL_ENCRYPTION_KEYS?: string;
  // Removes one user from the Auth provider, given the verified user ID of the
  // account deleting itself. Only deployments that can do this without a
  // service-role key provide it; without it accounts cannot be deleted.
  DELETE_AUTH_USER?: (userId: string) => Promise<void>;
  // The fields below are set only on the per-account Env built from that
  // account's sealed connection (see configurationEnv). They are never
  // deployment settings, and accounts never inherit service-level values.
  OWNER_ID?: string;
  ARK_API_KEY?: string;
  ARK_PROJECT?: string;
  ARK_AGENT_ID?: string;
  ARK_AGENT_VERSION?: string;
  ARK_ENVIRONMENT_ID?: string;
  ARK_MEMORY_STORE_ID?: string;
  // Internal flag for a verified account connection. Not client input.
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

// Where this deployment sends MA requests, for an ArkClient configuration.
export function maEndpoint(env: Env) {
  const provider = maProvider(env.MA_PROVIDER);
  return { arkBaseUrl: provider.baseUrl, provider };
}
