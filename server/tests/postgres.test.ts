import { describe, expect, it } from "vitest";
import { PgDatabase, placeholders } from "../src/postgres";

describe("Postgres adapter", () => {
  it("numbers placeholders outside quoted text", () => {
    expect(
      placeholders("SELECT ? WHERE a='x?y' AND b=? AND c IN (?,?)"),
    ).toBe("SELECT $1 WHERE a='x?y' AND b=$2 AND c IN ($3,$4)");
  });

  it("returns numbers for 64-bit integers and counts changed rows", async () => {
    const calls: [string, unknown[]][] = [];
    const db = new PgDatabase({
      query: async (sql, params) => {
        calls.push([sql, params]);
        return { rows: [{ n: 1790859651121n, s: "x" }], affected: 3 };
      },
      transaction: async (fn) => fn(async () => ({ rows: [], affected: 1 })),
    });
    expect(await db.prepare("SELECT ? AS n").bind(undefined).first()).toEqual({
      n: 1790859651121,
      s: "x",
    });
    expect(calls[0]).toEqual(["SELECT $1 AS n", [null]]);
    expect((await db.prepare("UPDATE t SET a=?").bind(1).run()).meta.changes).toBe(3);
    expect(
      await db.batch([db.prepare("UPDATE a SET b=1"), db.prepare("UPDATE c SET d=1")]),
    ).toEqual([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);
  });
});
