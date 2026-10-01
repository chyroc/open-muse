// The SQL surface the service uses. Cloudflare D1 satisfies it directly; the
// Postgres adapter in ./postgres.ts implements it for other deployments. SQL
// written against it must run on both SQLite and Postgres: `?` placeholders,
// ON CONFLICT upserts, CAST(? AS BIGINT) where a parameter's type cannot be
// inferred, and no SQLite-only functions.
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Database {
  prepare(sql: string): Statement;
  // Runs all statements in one transaction, in order.
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}
