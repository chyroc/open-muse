import { t } from "../shared/i18n";
import { AccountRequestError, SupabaseAuth } from "./supabase-auth";
import {
  authToken,
  supabaseOwner,
  supabaseSessionSchema,
  type SupabaseSession,
} from "../shared/supabase-auth";
import {
  accountCredentialResponseSchema,
  type AccountCredential,
} from "../shared/account-credential";
import {
  accountWorkspaceComparisonSchema,
  accountWorkspaceResponseSchema,
} from "../shared/account-workspace";

// Carries the service's machine-readable reason so callers can act on it.
export class BackgroundRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
const reasons = (): Record<string, string> => ({
  settings_pending: t(
    "A workspace settings change is unconfirmed. Open Muse checks it before anything else is changed.",
  ),
  settings_review: t(
    "The workspace settings need your review: they reference resources an account cannot use or differ from what Open Muse saved. Nothing was changed.",
  ),
  rebuild_review: t(
    "A deleted agent or environment cannot be restored because its saved settings reference resources an account cannot use. The saved settings are kept; recreate it with default settings to continue.",
  ),
  unconfirmed: t(
    "The change was sent but its result is unconfirmed. Open Muse checks it before anything else is changed; it was not repeated.",
  ),
  settings_changed: t(
    "Ark's settings changed after you reviewed them. Review them again; nothing was saved.",
  ),
});
const RENEW_MARGIN = 120_000;
const credentialStatus = z.object({
  configured: z.boolean(),
  revision: z.number().int().positive(),
  updatedAt: z.number().nullable(),
});
import { z } from "zod";
import { backgroundOrigin } from "../shared/background-origin";
import { digest, uuid } from "../shared/crypto";
import { boundedSignal } from "../shared/abort";
import { parseInspiration } from "../shared/inspiration";
import {
  backgroundConfigurationSchema,
  type BackgroundConfiguration,
} from "../shared/background-connection";
import type {
  BackgroundPost,
  BackgroundRun,
  BackgroundSchedule,
  BackgroundStatus,
} from "../shared/background";
import {
  backgroundCredentials,
  LocalDatabase,
  type CredentialStore,
} from "./direct/storage";

const saved = z
  .object({
    origin: z.string(),
    token: z.string(),
    owner: z.string().min(1),
    pending: z.string().optional(),
    account: z
      .object({
        origin: z.string(),
        session: supabaseSessionSchema,
        refreshPending: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) =>
    value.account
      ? authToken.safeParse(value.token).success &&
        value.token === value.account.session.accessToken &&
        value.owner ===
          supabaseOwner(value.account.origin, value.account.session.userId)
      : /^muse_device_[A-Za-z0-9_-]{32,128}$/.test(value.token),
  );
const scheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string(),
  local_time: z.string(),
  next_run_at: z.number().nullable(),
  revision: z.number().int().nonnegative(),
});
const statusSchema = z.object({
  connected: z.literal(true),
  owner: z.string().min(1),
  backgroundReady: z.boolean(),
  credentialStorageReady: z.boolean().optional(),
  account: z
    .object({
      provider: z.literal("supabase"),
      credential: z.object({
        configured: z.boolean(),
        revision: z.number().int().nonnegative(),
        updatedAt: z.number().nullable(),
      }),
    })
    .optional(),
  connection: z
    .object({
      configured: z.boolean(),
      revision: z.number().int().nonnegative(),
      updatedAt: z.number().nullable(),
    })
    .optional(),
  schedule: scheduleSchema,
});
const runSchema = z.object({
  id: z.string(),
  phase: z.enum([
    "queued",
    "creating",
    "ready",
    "sending",
    "running",
    "complete",
    "failed",
    "needs_attention",
  ]),
  session_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  scheduled_for: z.number(),
});
type Credentials = z.infer<typeof saved>;
type Cache = { items: BackgroundPost[]; cursor: number };

export class BackgroundClient {
  readonly origin: string;
  private current?: Credentials;
  private abort = new AbortController();
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    origin = import.meta.env.VITE_MUSE_BACKGROUND_URL ?? "",
    private vault: CredentialStore = backgroundCredentials,
    private database = new LocalDatabase(),
    private fetcher: typeof fetch = fetch,
    readonly accounts = new SupabaseAuth(),
  ) {
    this.origin = backgroundOrigin(origin);
  }
  configured() {
    return Boolean(this.origin);
  }
  connected() {
    return Boolean(this.current);
  }
  pending() {
    return Boolean(this.current?.pending);
  }
  accountConfigured() {
    return this.configured() && this.accounts.configured();
  }
  accountConnected() {
    return Boolean(this.current?.account);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.serial.then(fn);
    this.serial = result.catch(() => {});
    return result;
  }
  async restore() {
    if (!this.origin) return;
    return this.exclusive(async () => {
      const raw = await this.vault.read();
      if (!raw) return;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(
          t(
            "The saved background connection is invalid. Remove it before connecting again.",
          ),
        );
      }
      const parsed = saved.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.origin !== this.origin ||
        (parsed.data.account &&
          parsed.data.account.origin !== this.accounts.origin)
      )
        throw new Error(
          t(
            "The saved background connection does not match this build. Remove it before connecting again.",
          ),
        );
      this.current = parsed.data;
    });
  }
  private async call(
    path: string,
    token: string,
    init: RequestInit = {},
    // Endpoint-specific wording for particular error statuses.
    messages: Partial<Record<number, string>> = {},
  ): Promise<unknown> {
    if (!this.origin || !path.startsWith("/v1/"))
      throw new Error(t("Background service is not configured."));
    const bound = boundedSignal([this.abort.signal, init.signal], 30000);
    try {
      const response = await this.fetcher(this.origin + path, {
        ...init,
        signal: bound.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
      if (!response.ok) {
        if (response.status === 401 && !token.startsWith("muse_device_"))
          await this.expire(token);
        // A machine-readable reason, when the service gives one; its wording
        // is never shown.
        const code = z
          .object({ code: z.string().max(40) })
          .safeParse(await response.json().catch(() => undefined)).data?.code;
        throw new BackgroundRequestError(
          (code && reasons()[code]) ??
            messages[response.status] ??
            (response.status === 401
              ? token.startsWith("muse_device_")
                ? t("This device token was rejected or revoked.")
                : t(
                    "The account session was rejected or expired. Sign in again.",
                  )
              : response.status === 409
                ? t(
                    "The action conflicts with current server state. Refresh and review the schedule or active run.",
                  )
                : response.status === 403 && !token.startsWith("muse_device_")
                  ? t(
                      "This workspace belongs to another Muse account. Nothing was changed.",
                    )
                  : response.status === 429
                    ? t("Too many attempts. Try again later.")
                    : response.status === 422
                      ? t(
                          "Ark could not verify this key or workspace. Check it and try again; nothing was saved.",
                        )
                      : t(
                          "Background service request failed (HTTP {status}).",
                          {
                            status: response.status,
                          },
                        )),
          code,
        );
      }
      return await response.json();
    } catch (e) {
      if (e instanceof BackgroundRequestError) throw e;
      throw new Error(
        t(
          "Could not confirm the background request. Refresh to check its result; no request was retried automatically.",
        ),
      );
    } finally {
      bound.dispose();
    }
  }
  connect(token: string) {
    return this.exclusive(async () => {
      if (!/^muse_device_[A-Za-z0-9_-]{32,128}$/.test(token))
        throw new Error(
          t("Enter a Muse device token, not an Ark or Cloudflare key."),
        );
      const status = statusSchema.parse(await this.call("/v1/status", token));
      const value = { origin: this.origin, token, owner: status.owner };
      await this.vault.write(JSON.stringify(value));
      this.current = value;
      return status;
    });
  }
  signInAccount(email: string, password: string) {
    return this.exclusive(async () => {
      if (this.current)
        throw new Error(
          t(
            "Disconnect the current background connection before signing in to another Muse account.",
          ),
        );
      if (!this.accountConfigured())
        throw new Error(
          t("Muse account login is not configured in this build."),
        );
      const session = await this.accounts.signIn(email, password);
      const status = statusSchema.parse(
        await this.call("/v1/status", session.accessToken),
      );
      if (
        status.owner !== supabaseOwner(this.accounts.origin, session.userId) ||
        status.account?.provider !== "supabase"
      )
        throw new Error(
          t(
            "The account identity changed. Sign out of Muse and sign in again.",
          ),
        );
      const value: Credentials = {
        origin: this.origin,
        token: session.accessToken,
        owner: status.owner,
        account: { origin: this.accounts.origin, session },
      };
      await this.vault.write(JSON.stringify(value));
      this.current = value;
      return status;
    });
  }
  signUpAccount(email: string, password: string) {
    return this.exclusive(async () => {
      if (this.current)
        throw new Error(
          t(
            "Disconnect the current background connection before signing in to another Muse account.",
          ),
        );
      if (!this.accountConfigured())
        throw new Error(
          t("Muse account login is not configured in this build."),
        );
      await this.accounts.signUp(email, password);
    });
  }
  renewAccountLogin() {
    return this.exclusive(() => this.renew(true));
  }
  // Access tokens are short-lived. Renew shortly before expiry, at the start of
  // an operation, so no request switches credentials halfway through.
  private async fresh() {
    const session = this.current?.account?.session;
    if (session && session.expiresAt - this.accounts.now() < RENEW_MARGIN)
      await this.renew(false);
  }
  private async renew(force: boolean) {
    if (typeof navigator === "undefined" || !navigator.locks)
      throw new Error(
        t(
          "This device cannot coordinate login renewal safely. Sign out of Muse and sign in again.",
        ),
      );
    return navigator.locks.request(
      `muse-account-renew:${this.origin}`,
      async () => {
        const c = this.credentials();
        if (!c.account) throw new Error(t("Sign in to a Muse account first."));
        // Another operation in this window may have renewed while this one
        // waited for the lock.
        if (
          !force &&
          c.account.session.expiresAt - this.accounts.now() >= RENEW_MARGIN &&
          !c.account.refreshPending
        )
          return;
        const disk = saved.safeParse(JSON.parse(await this.vault.read()));
        if (
          !disk.success ||
          disk.data.owner !== c.owner ||
          disk.data.token !== c.token ||
          disk.data.account?.session.refreshToken !==
            c.account.session.refreshToken
        )
          throw new Error(
            t(
              "The account connection changed in another window. Sign out of Muse and sign in again.",
            ),
          );
        if (c.account.refreshPending || disk.data.account.refreshPending)
          throw new Error(
            t(
              "The previous login renewal could not be confirmed. Sign out of Muse and sign in again; it was not retried.",
            ),
          );
        const pending: Credentials = {
          ...c,
          account: { ...c.account, refreshPending: true },
        };
        await this.vault.write(JSON.stringify(pending));
        this.current = pending;
        let session: SupabaseSession;
        try {
          session = await this.accounts.renew(c.account.session);
        } catch (error) {
          // A definite rejection means the refresh token can never work
          // again; an unconfirmed result keeps the pending marker instead.
          if (error instanceof AccountRequestError) await this.expire(c.token);
          throw error;
        }
        // The old refresh token is spent. Persist the verified same-user
        // rotation before any later request can fail and lose it.
        const next: Credentials = {
          ...c,
          token: session.accessToken,
          account: { origin: c.account.origin, session },
        };
        await this.vault.write(JSON.stringify(next));
        this.current = next;
        const status = statusSchema.parse(
          await this.call("/v1/status", session.accessToken),
        );
        if (status.owner !== c.owner || status.account?.provider !== "supabase")
          throw new Error(
            t(
              "The account identity changed. Sign out of Muse and sign in again.",
            ),
          );
      },
    );
  }
  // No owner while a renewal is unconfirmed: the session cannot be used.
  accountOwner() {
    return this.current?.account && !this.current.account.refreshPending
      ? this.current.owner
      : undefined;
  }
  accountSessionUnconfirmed() {
    return Boolean(this.current?.account?.refreshPending);
  }
  // The provider no longer accepts this session: remove it so the app treats
  // the device as signed out instead of continuing with the account's key.
  private async expire(token: string) {
    if (this.current?.token !== token || !this.current.account) return;
    this.current = undefined;
    try {
      const saved = JSON.parse((await this.vault.read()) || "{}");
      if (saved.token === token) await this.vault.write("");
    } catch {
      /* The in-memory session is gone either way. */
    }
  }
  // Signing out revokes this session at the provider once, then always removes
  // it from this device. Other devices stay signed in.
  signOutAccount() {
    this.abort.abort();
    return this.exclusive(async () => {
      const c = this.credentials();
      if (!c.account) throw new Error(t("Sign in to a Muse account first."));
      let revoked = true;
      try {
        await this.accounts.signOut(c.token);
      } catch {
        revoked = false;
      }
      await this.vault.write("");
      this.current = undefined;
      this.abort = new AbortController();
      return { revoked };
    });
  }
  private accountRequest<T>(
    path:
      | "/v1/account/credential"
      | "/v1/account/workspace"
      | "/v1/account/workspace/settings"
      | "/v1/account/workspace/reconcile"
      | "/v1/account/workspace/compare",
    schema: z.ZodType<T>,
    init?: RequestInit,
    messages?: Partial<Record<number, string>>,
  ) {
    return this.exclusive(async () => {
      await this.status();
      const c = this.credentials();
      if (!c.account) throw new Error(t("Sign in to a Muse account first."));
      const result = schema.parse(
        await this.call(path, c.token, init, messages),
      );
      this.assertCurrent(c);
      return result;
    });
  }
  // The key returns only to a verified session of the same account. It is kept
  // in memory by the caller and never written to this device's storage.
  accountCredential() {
    return this.accountRequest(
      "/v1/account/credential",
      accountCredentialResponseSchema,
    );
  }
  saveAccountCredential(credential: AccountCredential, revision: number) {
    return this.accountRequest("/v1/account/credential", credentialStatus, {
      method: "PUT",
      body: JSON.stringify({ credential, revision, confirm: true }),
    });
  }
  removeAccountCredential(revision: number) {
    return this.accountRequest("/v1/account/credential", credentialStatus, {
      method: "DELETE",
      body: JSON.stringify({ revision, confirm: true }),
    });
  }
  // The account's workspace configuration for its current key, as sealed by
  // the service. Nothing is created by reading it.
  accountWorkspace() {
    return this.accountRequest(
      "/v1/account/workspace",
      accountWorkspaceResponseSchema,
    );
  }
  // The service creates any missing workspace resource with the account's own
  // key and records it from its own creation response. Sent once; an
  // unconfirmed result is checked on the next explicit attempt, not repeated.
  provisionAccountWorkspace(
    credentialRevision: number,
    replaceUnconfirmed = false,
    resetSettings = false,
  ) {
    return this.accountRequest(
      "/v1/account/workspace",
      accountWorkspaceResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          credentialRevision,
          ...(replaceUnconfirmed ? { replaceUnconfirmed } : {}),
          ...(resetSettings ? { resetSettings } : {}),
          confirm: true,
        }),
      },
      {
        409: t(
          "Workspace setup needs review: an earlier step may have created a resource Open Muse will not use, or another device is preparing it. Continue setup to create a new one.",
        ),
        503: t(
          "The workspace setup result is unconfirmed. Continue setup to check it; nothing was repeated.",
        ),
      },
    );
  }
  // Changes the account's own agent or environment through the service, which
  // applies it once and seals the resulting settings with the account.
  // Resolves an unconfirmed settings change by reading Ark on the service;
  // nothing is sent to Ark. adopt saves the current values only after the
  // user reviewed them.
  reconcileAccountWorkspace(
    revision: number,
    credentialRevision: number,
    mode?: "adopt" | "discard",
    // Adopting names the reviewed values, from compareAccountWorkspace.
    expected?: string,
  ) {
    return this.accountRequest(
      "/v1/account/workspace/reconcile",
      accountWorkspaceResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          revision,
          credentialRevision,
          ...(mode ? { mode } : {}),
          ...(expected ? { expected } : {}),
          confirm: true,
        }),
      },
    );
  }
  // Reads Ark's current values for the settings under review, next to the
  // saved ones, on the service; nothing is changed.
  compareAccountWorkspace(revision: number, credentialRevision: number) {
    return this.accountRequest(
      "/v1/account/workspace/compare",
      accountWorkspaceComparisonSchema,
      {
        method: "POST",
        body: JSON.stringify({ revision, credentialRevision, confirm: true }),
      },
    );
  }
  updateAccountWorkspace(
    kind: "agent" | "environment",
    changes: Record<string, unknown>,
    revision: number,
    credentialRevision: number,
  ) {
    return this.accountRequest(
      "/v1/account/workspace/settings",
      accountWorkspaceResponseSchema,
      {
        method: "PUT",
        body: JSON.stringify({
          kind,
          changes,
          revision,
          credentialRevision,
          confirm: true,
        }),
      },
      {
        409: t(
          "The workspace settings changed on another device. Refresh and review them before saving again.",
        ),
        503: t(
          "The change is unconfirmed. Refresh the workspace to check it; it was not repeated.",
        ),
      },
    );
  }
  disconnect() {
    this.abort.abort();
    return this.exclusive(async () => {
      await this.vault.write("");
      this.current = undefined;
      this.abort = new AbortController();
    });
  }
  private credentials() {
    if (!this.current)
      throw new Error(t("Connect to the background service first."));
    return this.current;
  }
  private assertCurrent(c: Credentials) {
    if (c !== this.current)
      throw new Error(
        t("The background connection changed; refresh before continuing."),
      );
  }
  async status(): Promise<BackgroundStatus> {
    await this.fresh();
    const c = this.credentials();
    if (c.account?.refreshPending)
      throw new Error(
        t(
          "The previous login renewal could not be confirmed. Sign out of Muse and sign in again; it was not retried.",
        ),
      );
    const result = statusSchema.parse(await this.call("/v1/status", c.token));
    this.assertCurrent(c);
    if (result.owner !== c.owner)
      throw new Error(
        t(
          "The service owner changed. Disconnect and verify the deployment before reconnecting.",
        ),
      );
    return result;
  }
  saveSchedule(value: BackgroundSchedule) {
    return this.exclusive(async () => {
      await this.status();
      const c = this.credentials();
      const { next_run_at: _, ...input } = value;
      const result = scheduleSchema.parse(
        await this.call("/v1/schedule", c.token, {
          method: "PUT",
          body: JSON.stringify({ ...input, confirm: true }),
        }),
      );
      this.assertCurrent(c);
      return result;
    });
  }
  async syncConfiguration(source: {
    backgroundConfiguration(confirm: boolean): Promise<BackgroundConfiguration>;
    accountCredentialRevision?(): number | undefined;
  }) {
    const owner = await this.exclusive(async () => {
      const status = await this.status();
      if (!status.credentialStorageReady || !status.connection)
        throw new Error(
          t("Encrypted credential storage is not available on this service."),
        );
      return status.owner;
    });
    // Reading the workspace makes Ark requests that re-verify the account
    // through this client, so it must not hold the request queue.
    const exported = await source.backgroundConfiguration(true);
    return this.exclusive(async () => {
      const status = await this.status(),
        c = this.credentials();
      if (c.owner !== owner || !status.connection)
        throw new Error(
          t("The background connection changed; refresh before continuing."),
        );
      const value = backgroundConfigurationSchema.safeParse(exported);
      if (!value.success)
        throw new Error(
          t(
            "The current Ark workspace is incomplete. Refresh it before syncing.",
          ),
        );
      this.assertCurrent(c);
      let body: object;
      if (c.account) {
        // The service already holds this account's key. Send only the
        // workspace resource IDs prepared with that same key revision.
        const revision = source.accountCredentialRevision?.();
        if (!status.account || revision !== status.account.credential.revision)
          throw new Error(
            t(
              "Your Ark API key changed on another device. Reload Settings before allowing background work.",
            ),
          );
        const { agentId, agentVersion, environmentId, memoryStoreId } =
          value.data;
        body = {
          workspace: { agentId, agentVersion, environmentId, memoryStoreId },
          credentialRevision: revision,
          revision: status.connection.revision,
          confirm: true,
        };
      } else
        body = {
          config: value.data,
          revision: status.connection.revision,
          confirm: true,
        };
      const result = await this.call("/v1/connection", c.token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      this.assertCurrent(c);
      return z
        .object({
          configured: z.literal(true),
          revision: z.number().int().positive(),
          updatedAt: z.number(),
        })
        .parse(result);
    });
  }
  removeConfiguration() {
    return this.exclusive(async () => {
      const status = await this.status(),
        c = this.credentials();
      if (!status.connection)
        throw new Error(
          t("Refresh the service before removing uploaded access."),
        );
      const result = await this.call("/v1/connection", c.token, {
        method: "DELETE",
        body: JSON.stringify({
          revision: status.connection.revision,
          confirm: true,
        }),
      });
      this.assertCurrent(c);
      return z
        .object({
          configured: z.literal(false),
          revision: z.number().int().positive(),
          updatedAt: z.number(),
        })
        .parse(result);
    });
  }
  generate() {
    return this.exclusive(async () => {
      await this.status();
      let c = this.credentials();
      if (!c.pending) {
        const value = { ...c, pending: uuid() };
        await this.vault.write(JSON.stringify(value));
        this.current = value;
        c = value;
      }
      const result = runSchema.parse(
        await this.call("/v1/runs", c.token, {
          method: "POST",
          headers: { "Idempotency-Key": c.pending! },
          body: JSON.stringify({ confirm: true }),
        }),
      );
      this.assertCurrent(c);
      const value = { ...c };
      delete value.pending;
      await this.vault.write(JSON.stringify(value));
      this.current = value;
      return result;
    });
  }
  recheck(id: string) {
    return this.exclusive(async () => {
      if (!/^[\w-]{1,80}$/.test(id))
        throw new Error(t("Invalid run reference."));
      await this.status();
      const c = this.credentials();
      await this.call(`/v1/runs/${id}/recheck`, c.token, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      this.assertCurrent(c);
    });
  }
  private cacheKey(c: Credentials) {
    return `background:${digest(JSON.stringify([c.origin, c.owner]))}`;
  }
  async cachedFeed(): Promise<Cache> {
    const c = this.credentials();
    return (
      (await this.database.get<Cache>(this.cacheKey(c))) ?? {
        items: [],
        cursor: 0,
      }
    );
  }
  async refresh() {
    return this.exclusive(async () => {
      const status = await this.status();
      const c = this.credentials();
      const { runs } = z
        .object({ runs: z.array(runSchema) })
        .parse(await this.call("/v1/runs", c.token));
      let cache = await this.cachedFeed();
      for (let page = 0; page < 10; page++) {
        const data = z
          .object({
            items: z.array(z.record(z.string(), z.unknown())),
            cursor: z.number().int().nonnegative(),
            hasMore: z.boolean(),
          })
          .parse(await this.call(`/v1/feed?after=${cache.cursor}`, c.token));
        if (
          data.cursor < cache.cursor ||
          (data.hasMore && data.cursor === cache.cursor)
        )
          throw new Error(t("Invalid background Feed cursor."));
        const items = data.items.map((raw) => {
          const { id, sequence, session_id, event_id, created_at, ...content } =
            raw;
          const meta = z
            .object({
              id: z.string(),
              sequence: z.number().int().positive(),
              session_id: z.string(),
              event_id: z.string(),
              created_at: z.number(),
            })
            .parse({ id, sequence, session_id, event_id, created_at });
          if (meta.sequence <= cache.cursor || meta.sequence > data.cursor)
            throw new Error(t("Invalid Feed ordering."));
          return {
            ...parseInspiration(JSON.stringify({ items: [content] }))[0],
            ...meta,
          };
        });
        this.assertCurrent(c);
        const byId = new Map(
          [...cache.items, ...items].map((item) => [item.id, item]),
        );
        cache = {
          items: [...byId.values()]
            .sort((a, b) => b.sequence - a.sequence)
            .slice(0, 500),
          cursor: data.cursor,
        };
        await this.database.set(this.cacheKey(c), cache);
        if (!data.hasMore) break;
      }
      this.assertCurrent(c);
      return { status, runs: runs as BackgroundRun[], items: cache.items };
    });
  }
}

export const backgroundClient = new BackgroundClient();
