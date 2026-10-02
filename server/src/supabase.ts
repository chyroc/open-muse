import {
  isSupabaseOwner,
  supabaseOrigin,
  supabaseOwner,
  supabasePublicKey,
  supabaseUserSchema,
  authToken,
} from "../../shared/supabase-auth";
import { HttpError, type Env } from "./env";

export { isSupabaseOwner };

export async function authenticateSupabase(
  token: string,
  env: Env,
  fetcher: typeof fetch,
) {
  let origin: string, key: string;
  try {
    origin = supabaseOrigin(env.SUPABASE_AUTH_URL);
    key = supabasePublicKey(env.SUPABASE_ANON_KEY);
    if (!origin || !key) throw new Error();
  } catch {
    throw new HttpError(503, "Supabase Auth is not configured.");
  }
  if (!authToken.safeParse(token).success)
    throw new HttpError(401, "Sign in to your Open Muse account again.");
  let response: Response;
  try {
    response = await fetcher(`${origin}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpError(
      503,
      "The account verification service is unavailable.",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new HttpError(401, "Sign in to your Open Muse account again.");
  if (!response.ok)
    throw new HttpError(
      503,
      "The account verification service is unavailable.",
    );
  try {
    const user = supabaseUserSchema.parse(await response.json());
    if (user.is_anonymous) throw new Error();
    return supabaseOwner(origin, user.id);
  } catch {
    throw new HttpError(
      401,
      "A verified, non-anonymous Open Muse account is required.",
    );
  }
}
