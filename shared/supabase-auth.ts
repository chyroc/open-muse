import { z } from "zod";
import { digest } from "./crypto";

// Only an explicitly configured public Auth origin is trusted. Never discover
// the verification endpoint from an unverified token or a client-supplied URL.
export function supabaseOrigin(value: string | undefined) {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.includes("*")
  )
    throw new Error(
      "Supabase Auth requires an HTTPS origin without a path, credentials, query, or fragment.",
    );
  return url.origin;
}

const uuid = z.string().uuid();
export const supabaseUserSchema = z.object({
  id: uuid,
  is_anonymous: z.boolean().optional(),
});
export const authToken = z
  .string()
  .min(20)
  .max(16384)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const supabaseSessionSchema = z
  .object({
    accessToken: authToken,
    refreshToken: z
      .string()
      .min(8)
      .max(4096)
      .regex(/^[A-Za-z0-9_.-]+$/),
    expiresAt: z.number().int().positive(),
    userId: uuid,
  })
  .strict();
export type SupabaseSession = z.infer<typeof supabaseSessionSchema>;

export function supabaseOwner(origin: string, verifiedSubject: string) {
  return `muse_user_${digest(JSON.stringify([supabaseOrigin(origin), uuid.parse(verifiedSubject)]))}`;
}
export const isSupabaseOwner = (owner: string) =>
  /^muse_user_[a-f0-9]{64}$/.test(owner);

// Neither service-role JWTs nor secret API keys belong in an app bundle.
export function supabasePublicKey(value: string | undefined) {
  if (!value) return "";
  if (
    !/^[A-Za-z0-9_.-]{20,16384}$/.test(value) ||
    value.startsWith("sb_secret_")
  )
    throw new Error("Configure only the Supabase anon or publishable key.");
  if (value.includes(".")) {
    try {
      const part = value
        .split(".")[1]
        .replaceAll("-", "+")
        .replaceAll("_", "/");
      if (JSON.parse(atob(part)).role !== "anon") throw new Error();
    } catch {
      throw new Error("Configure only the Supabase anon or publishable key.");
    }
  } else if (!value.startsWith("sb_publishable_")) {
    throw new Error("Configure only the Supabase anon or publishable key.");
  }
  return value;
}
