import { edgeFetch } from "./fetch";
import { HttpError, type Env } from "./env";
import { authenticateSupabase, isSupabaseOwner } from "./supabase";

export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DeviceIdentity {
  ownerId: string;
  deviceLabel: string;
}
export function deviceIdentities(env: Env): Record<string, DeviceIdentity> {
  if (!env.DEVICE_TOKEN_HASHES)
    throw new HttpError(503, "Device access is not configured.");
  try {
    const hashes = JSON.parse(env.DEVICE_TOKEN_HASHES);
    if (
      !hashes ||
      Array.isArray(hashes) ||
      typeof hashes !== "object" ||
      !Object.keys(hashes).length ||
      Object.keys(hashes).length > 200 ||
      Object.entries(hashes).some(([k, v]) => {
        const identity = v as DeviceIdentity;
        return (
          !/^[a-f0-9]{64}$/.test(k) ||
          !identity ||
          typeof identity !== "object" ||
          Array.isArray(identity) ||
          Object.keys(identity).length !== 2 ||
          !Object.hasOwn(identity, "ownerId") ||
          !Object.hasOwn(identity, "deviceLabel") ||
          typeof identity.ownerId !== "string" ||
          !/^[\w-]{1,128}$/.test(identity.ownerId) ||
          isSupabaseOwner(identity.ownerId) ||
          typeof identity.deviceLabel !== "string" ||
          !/^[^\r\n]{1,80}$/.test(identity.deviceLabel)
        );
      })
    )
      throw new Error();
    return hashes;
  } catch {
    throw new HttpError(503, "Device access is not configured.");
  }
}
export function authorizedOwners(env: Env) {
  return [
    ...new Set(
      Object.values(deviceIdentities(env)).map((device) => device.ownerId),
    ),
  ];
}
export async function authenticate(
  request: Request,
  env: Env,
  fetcher: typeof fetch = edgeFetch,
) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (
    !authorization.startsWith("Bearer muse_device_") &&
    env.SUPABASE_AUTH_URL
  ) {
    const bearer = /^Bearer ([A-Za-z0-9_.-]{20,16384})$/.exec(authorization);
    if (!bearer)
      throw new HttpError(401, "Sign in to your Open Muse account again.");
    return authenticateSupabase(bearer[1], env, fetcher);
  }
  const hashes = deviceIdentities(env);
  const match = /^Bearer (muse_device_[A-Za-z0-9_-]{32,128})$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  const hash = match ? await tokenHash(match[1]) : "";
  if (!Object.hasOwn(hashes, hash))
    throw new HttpError(401, "Connect with an authorized device token.");
  return hashes[hash].ownerId;
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
