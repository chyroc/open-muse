import type { Database, Statement } from "./database";

// Runs one query on a Postgres connection: `$n` placeholders, rows as objects.
export type PgQuery = (
  sql: string,
  params: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; affected: number }>;

export interface PgExecutor {
  query: PgQuery;
  // Runs `fn` inside one transaction on a single connection.
  transaction<T>(fn: (query: PgQuery) => Promise<T>): Promise<T>;
}

// `?` placeholders become `$1..$n`; quoted text is left alone.
export function placeholders(sql: string) {
  let out = "",
    n = 0,
    quoted = false;
  for (const char of sql) {
    if (char === "'") quoted = !quoted;
    out += char === "?" && !quoted ? `$${++n}` : char;
  }
  return out;
}

// Postgres returns 64-bit integers as bigint; the service uses numbers
// (millisecond timestamps and counters stay far below 2^53).
function row(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value))
    out[key] = typeof field === "bigint" ? Number(field) : field;
  return out;
}

class PgStatement implements Statement {
  constructor(
    private db: PgDatabase,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new PgStatement(this.db, this.sql, values);
  }
  async exec(query: PgQuery = this.db.executor.query) {
    const result = await query(
      this.sql,
      this.params.map((value) => (value === undefined ? null : value)),
    );
    return { rows: result.rows.map(row), affected: result.affected };
  }
  async first<T>() {
    return ((await this.exec()).rows[0] as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: (await this.exec()).rows as T[] };
  }
  async run() {
    return { meta: { changes: (await this.exec()).affected } };
  }
}

export class PgDatabase implements Database {
  constructor(readonly executor: PgExecutor) {}
  prepare(sql: string) {
    return new PgStatement(this, placeholders(sql));
  }
  batch(statements: Statement[]) {
    return this.executor.transaction(async (query) => {
      const results: { meta: { changes: number } }[] = [];
      for (const statement of statements)
        results.push({
          meta: { changes: (await (statement as PgStatement).exec(query)).affected },
        });
      return results;
    });
  }
}
