import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";

export async function database() {
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
