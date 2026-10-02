import { edgeFetch } from "./fetch";
import { HttpError, type Env } from "./env";
import { authenticateSupabase } from "./supabase";

export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Every request is made on behalf of a verified Open Muse account. Without a
// configured Auth provider the service serves no one.
export async function authenticate(
  request: Request,
  env: Env,
  fetcher: typeof fetch = edgeFetch,
) {
  if (!env.SUPABASE_AUTH_URL)
    throw new HttpError(503, "Open Muse accounts are not configured.");
  const bearer = /^Bearer ([A-Za-z0-9_.-]{20,16384})$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (!bearer)
    throw new HttpError(401, "Sign in to your Open Muse account again.");
  return authenticateSupabase(bearer[1], env, fetcher);
}

export function checkOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // Native HTTP clients may have no Origin; auth still applies.
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin === "null" || !allowed.includes(origin))
    throw new HttpError(403, "This application origin is not allowed.");
  return origin;
}
