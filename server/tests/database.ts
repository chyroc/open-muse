import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDatabase } from "../src/postgres";
import type { Database } from "../src/database";

// TEST_DB=pg runs the same tests on Postgres (PGlite) with the Postgres
// schema, as deployed on Volcengine.
export const postgresTests = process.env.TEST_DB === "pg";

async function postgres() {
  const pg = new PGlite();
  const dir = new URL("../migrations-postgres/", import.meta.url);
  for (const file of readdirSync(dir).filter((p) => p.endsWith(".sql")).sort())
    await pg.exec(readFileSync(new URL(file, dir), "utf8"));
  // Failing statements are printed, since the API turns them into 500s.
  const traced = async (
    run: () => Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>,
    sql: string,
  ) => {
    try {
      const result = await run();
      return { rows: result.rows, affected: result.affectedRows ?? 0 };
    } catch (error) {
      if (process.env.TEST_DB_TRACE)
        console.error(`PG ${(error as Error).message}\n  ${sql.replace(/\s+/g, " ").slice(0, 300)}`);
      throw error;
    }
  };
  const db = new PgDatabase({
    query: (sql, params) =>
      traced(() => pg.query<Record<string, unknown>>(sql, params), sql),
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((sql, params) =>
          traced(() => tx.query<Record<string, unknown>>(sql, params), sql),
        ),
      ),
  });
  return { db: db as Database as D1Database, dispose: () => pg.close() };
}

export async function database() {
  if (postgresTests) return postgres();
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-01-14",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  const dir = new URL("../migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((p) => p.endsWith(".sql"))
    .sort()
    .map((p) => readFileSync(new URL(p, dir), "utf8"))
    .join("\n");
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  return { db: db as unknown as D1Database, dispose: () => mf.dispose() };
}
