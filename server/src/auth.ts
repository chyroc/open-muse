import { HttpError, type Env } from "./env";

export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function authenticate(request: Request, env: Env) {
  if (!env.OWNER_ID || !env.DEVICE_TOKEN_HASHES)
    throw new HttpError(503, "Device access is not configured.");
  let hashes: Record<string, string>;
  try {
    hashes = JSON.parse(env.DEVICE_TOKEN_HASHES);
    if (
      !hashes ||
      Array.isArray(hashes) ||
      typeof hashes !== "object" ||
      !Object.keys(hashes).length ||
      Object.entries(hashes).some(
        ([k, v]) => !/^[a-f0-9]{64}$/.test(k) || typeof v !== "string",
      )
    )
      throw new Error();
  } catch {
    throw new HttpError(503, "Device access is not configured.");
  }
  const match = /^Bearer (muse_device_[A-Za-z0-9_-]{32,128})$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (!match || !Object.hasOwn(hashes, await tokenHash(match[1])))
    throw new HttpError(401, "Connect with an authorized device token.");
  return env.OWNER_ID;
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
