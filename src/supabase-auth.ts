import { z } from "zod";
import { t } from "../shared/i18n";
import { boundedSignal } from "../shared/abort";
import {
  authToken,
  supabaseOrigin,
  supabasePublicKey,
  supabaseSessionSchema,
  supabaseUserSchema,
  type SupabaseSession,
} from "../shared/supabase-auth";

// The provider answered with an error status: the request definitely failed.
export class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    // Auth's own reason, such as "invalid_credentials".
    readonly code?: string,
  ) {
    super(message);
  }
}
// What a person can do about a refused login, sign-up, or renewal.
function accountProblem(status: number, code = "") {
  switch (code) {
    case "invalid_credentials":
      return t("The email or password is incorrect.");
    case "user_already_exists":
    case "email_exists":
      return t("An account with this email already exists. Sign in instead.");
    case "weak_password":
      return t("Choose a longer password, at least 8 characters.");
    case "email_not_confirmed":
      return t("Confirm your email with the link sent to it, then sign in.");
    case "signup_disabled":
      return t("New accounts cannot be created right now.");
    case "user_banned":
      return t("This account cannot sign in.");
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return t("Too many sign-in attempts. Wait a few minutes and try again.");
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "session_not_found":
    case "session_expired":
    case "bad_jwt":
      return t("Your sign-in has expired. Sign in again.");
  }
  if (status === 429)
    return t("Too many sign-in attempts. Wait a few minutes and try again.");
  if (status >= 500)
    return t(
      "The account service is temporarily unavailable. Try again later.",
    );
  return t(
    "Account request failed (HTTP {status}). Check your login or provider configuration; no request was retried.",
    { status },
  );
}
const login = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(1024),
  })
  .strict();

// A small Auth REST client deliberately has no automatic refresh, timers,
// browser storage, write retries, or privileged API-key dependency.
// One image in an account's folder, the folder's listing, or a batch removal.
const storagePath =
  /^\/object\/(?:(?:authenticated\/)?attachments\/[0-9a-f-]{36}\/[\w-]{1,200}|list\/attachments|attachments)$/;

export class SupabaseAuth {
  readonly origin: string;
  private key: string;
  constructor(
    origin = import.meta.env.VITE_MUSE_SUPABASE_URL ?? "",
    publicKey = import.meta.env.VITE_MUSE_SUPABASE_ANON_KEY ?? "",
    // Browsers reject fetch called as a method of another object, so the
    // default must not be the bare global stored on this instance.
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
    private clock = Date.now,
  ) {
    this.origin = supabaseOrigin(origin);
    this.key = supabasePublicKey(publicKey);
    if (Boolean(this.origin) !== Boolean(this.key))
      throw new Error(
        "Configure the Supabase Auth origin and public key together.",
      );
  }
  configured() {
    return Boolean(this.origin && this.key);
  }
  // The clock session expiry times are measured against.
  now() {
    return this.clock();
  }
  // A request to the workspace's file storage, signed by an account session.
  // Only the attachment image paths are reachable. The body is read within
  // the time limit too.
  async storage(
    path: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; body: Blob }> {
    if (!this.configured())
      throw new Error(
        t("Open Muse account login is not configured in this build."),
      );
    if (!storagePath.test(path)) throw new Error("Invalid storage path.");
    authToken.parse(accessToken);
    const bound = boundedSignal([init.signal], 30000);
    try {
      const response = await this.fetcher(`${this.origin}/storage/v1${path}`, {
        ...init,
        signal: bound.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          ...init.headers,
          apikey: this.key,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.blob();
      return { ok: response.ok, status: response.status, body };
    } finally {
      bound.dispose();
    }
  }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.configured())
      throw new Error(
        t("Open Muse account login is not configured in this build."),
      );
    const bound = boundedSignal([init.signal], 15000);
    try {
      const response = await this.fetcher(`${this.origin}/auth/v1${path}`, {
        ...init,
        signal: bound.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          apikey: this.key,
          ...init.headers,
        },
      });
      if (!response.ok) {
        const reason = (await response.json().catch(() => undefined)) as
          { error_code?: unknown } | undefined;
        const code =
          typeof reason?.error_code === "string" &&
          /^[a-z_]{1,60}$/.test(reason.error_code)
            ? reason.error_code
            : undefined;
        throw new AccountRequestError(
          accountProblem(response.status, code),
          response.status,
          code,
        );
      }
      return response.status === 204
        ? {}
        : ((await response.json()) as unknown);
    } catch (error) {
      if (error instanceof AccountRequestError) throw error;
      throw new Error(
        t(
          "The account request could not be confirmed. It was not retried automatically.",
        ),
      );
    } finally {
      bound.dispose();
    }
  }
  private input(email: string, password: string) {
    const parsed = login.safeParse({ email, password });
    if (!parsed.success)
      throw new Error(
        t("Enter a valid email and a password of at least 8 characters."),
      );
    return parsed.data;
  }
  private session(value: unknown): SupabaseSession {
    const response = z
      .object({
        access_token: authToken,
        refresh_token: supabaseSessionSchema.shape.refreshToken,
        expires_in: z.number().int().min(1).max(86400),
        token_type: z.literal("bearer"),
        user: supabaseUserSchema,
      })
      .safeParse(value);
    if (!response.success || response.data.user.is_anonymous)
      throw new Error(
        t(
          "The account service returned an invalid login. No credentials were saved.",
        ),
      );
    return supabaseSessionSchema.parse({
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: this.clock() + response.data.expires_in * 1000,
      userId: response.data.user.id,
    });
  }
  async signIn(email: string, password: string) {
    const input = this.input(email, password);
    return this.session(
      await this.request("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  }
  async signUp(email: string, password: string) {
    const input = this.input(email, password);
    try {
      await this.request("/signup", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
      // Provider status codes can reveal whether an email is registered,
      // so only reasons that say nothing about the email are passed on.
      if (
        error instanceof AccountRequestError &&
        (error.code === "weak_password" ||
          error.status === 429 ||
          (error.status ?? 0) >= 500)
      )
        throw error;
      if (error instanceof AccountRequestError)
        throw new Error(
          t(
            "The registration was not accepted. Check the email and password, or sign in if you already have an account. It was not retried.",
          ),
        );
      throw error;
    }
    // Signup can require email verification. Do not infer successful login,
    // disclose account existence, or adopt a signup session without review.
  }
  // Revokes this session's refresh token at the provider. Sent once; the
  // caller removes the local session whatever the outcome.
  async signOut(accessToken: string) {
    authToken.parse(accessToken);
    await this.request("/logout?scope=local", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  async renew(session: SupabaseSession) {
    const checked = supabaseSessionSchema.parse(session);
    const next = this.session(
      await this.request("/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: checked.refreshToken }),
      }),
    );
    if (next.userId !== checked.userId)
      throw new Error(
        t(
          "The account identity changed. Sign out of Open Muse and sign in again.",
        ),
      );
    return next;
  }
}
