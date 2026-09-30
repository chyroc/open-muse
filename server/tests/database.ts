import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";

export async function database() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-01-14",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  const sql = readFileSync(
    new URL("../migrations/0001_background_feed.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  return { db: db as unknown as D1Database, dispose: () => mf.dispose() };
}
