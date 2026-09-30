import { z } from "zod";
import { backgroundOrigin } from "../shared/background-origin";
import { digest, uuid } from "../shared/crypto";
import { boundedSignal } from "../shared/abort";
import { parseInspiration } from "../shared/inspiration";
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
    token: z.string().regex(/^muse_device_[A-Za-z0-9_-]{32,128}$/),
    owner: z.string().min(1),
    pending: z.string().optional(),
  })
  .strict();
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
          "The saved background connection is invalid. Remove it before connecting again.",
        );
      }
      const parsed = saved.safeParse(value);
      if (!parsed.success || parsed.data.origin !== this.origin)
        throw new Error(
          "The saved background connection does not match this build. Remove it before connecting again.",
        );
      this.current = parsed.data;
    });
  }
  private async call(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    if (!this.origin || !path.startsWith("/v1/"))
      throw new Error("Background service is not configured.");
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
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "This device token was rejected or revoked."
            : response.status === 409
              ? "The action conflicts with current server state. Refresh and review the schedule or active run."
              : `Background service request failed (HTTP ${response.status}).`,
        );
      return await response.json();
    } catch (e) {
      if (
        (e instanceof Error &&
          e.message.startsWith("Background service request failed")) ||
        (e instanceof Error &&
          /^(This device token|The action conflicts)/.test(e.message))
      )
        throw e;
      throw new Error(
        "Could not confirm the background request. Refresh to check its result; no request was retried automatically.",
      );
    } finally {
      bound.dispose();
    }
  }
  connect(token: string) {
    return this.exclusive(async () => {
      if (!/^muse_device_[A-Za-z0-9_-]{32,128}$/.test(token))
        throw new Error(
          "Enter a Muse device token, not an Ark or Cloudflare key.",
        );
      const status = statusSchema.parse(await this.call("/v1/status", token));
      const value = { origin: this.origin, token, owner: status.owner };
      await this.vault.write(JSON.stringify(value));
      this.current = value;
      return status;
    });
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
      throw new Error("Connect to the background service first.");
    return this.current;
  }
  private assertCurrent(c: Credentials) {
    if (c !== this.current)
      throw new Error(
        "The background connection changed; refresh before continuing.",
      );
  }
  async status(): Promise<BackgroundStatus> {
    const c = this.credentials();
    const result = statusSchema.parse(await this.call("/v1/status", c.token));
    this.assertCurrent(c);
    if (result.owner !== c.owner)
      throw new Error(
        "The service owner changed. Disconnect and verify the deployment before reconnecting.",
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
      if (!/^[\w-]{1,80}$/.test(id)) throw new Error("Invalid run reference.");
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
          throw new Error("Invalid background Feed cursor.");
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
            throw new Error("Invalid Feed ordering.");
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
