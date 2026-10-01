import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Mac build runs on a case-insensitive file system, where two modules
// whose names differ only in case resolve to the same file.
describe("Mac source file names", () => {
  it("never differ only in letter case", () => {
    for (const folder of ["macos/ui", "macos/tests", "shared", "src"]) {
      const names = readdirSync(folder).map((name) =>
        name.replace(/\.tsx?$/, "").toLowerCase(),
      );
      const seen = new Set<string>();
      for (const name of names) {
        expect(seen.has(name), `${folder}/${name}`).toBe(false);
        seen.add(name);
      }
    }
  });
});
