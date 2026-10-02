// Volcengine Supabase Edge Function (Deno) serving the Open Muse API. Bundled
// by build-function.mjs; `jsr:` imports stay external for the Deno runtime.
import { Pool } from "jsr:@db/postgres@0.19.5";
import { handle } from "../../../src/index";
import { PgDatabase, type PgQuery } from "../../../src/postgres";
import type { Env } from "../../../src/env";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

// A dedicated database role that can reach only the open_muse schema.
const pool = new Pool(required("OPEN_MUSE_DATABASE_URL"), 3, true);

type Client = Awaited<ReturnType<Pool["connect"]>>;
const run =
  (client: Client): PgQuery =>
  async (text, args) => {
    const result = await client.queryObject<Record<string, unknown>>({
      text,
      args,
    });
    return { rows: result.rows, affected: result.rowCount ?? 0 };
  };

const db = new PgDatabase({
  async query(text, args) {
    const client = await pool.connect();
    try {
      return await run(client)(text, args);
    } finally {
      client.release();
    }
  },
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.queryArray("BEGIN");
      try {
        const result = await fn(run(client));
        await client.queryArray("COMMIT");
        return result;
      } catch (error) {
        await client.queryArray("ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      client.release();
    }
  },
});

const env: Env = {
  DB: db,
  SUPABASE_AUTH_URL: required("OPEN_MUSE_AUTH_URL"),
  SUPABASE_ANON_KEY: required("OPEN_MUSE_ANON_KEY"),
  ALLOWED_ORIGINS:
    Deno.env.get("OPEN_MUSE_ALLOWED_ORIGINS") ??
    "capacitor://localhost,muse://app",
  BACKGROUND_ENABLED: Deno.env.get("OPEN_MUSE_BACKGROUND_ENABLED") ?? "true",
  SCHEDULER_SOURCE: "external",
  SCHEDULER_TRIGGER_SECRET: Deno.env.get("SCHEDULER_TRIGGER_SECRET"),
  CREDENTIAL_ENCRYPTION_KEYS: Deno.env.get("CREDENTIAL_ENCRYPTION_KEYS"),
};

// The gateway passes `/<function-name>/<path>`; the service routes on <path>.
Deno.serve((request) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/[^/]+/, "") || "/";
  return handle(new Request(url, request), env);
});
