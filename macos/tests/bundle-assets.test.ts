import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundled page assets", () => {
  it("compares standardized paths on both sides of the prefix check", () => {
    // Standardizing drops a leading /private, so an app opened from
    // /private/tmp only serves its pages when the root is standardized too.
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain(
      'appendingPathComponent("web", isDirectory: true).standardizedFileURL',
    );
    expect(swift).toContain('file.path.hasPrefix(root.path + "/")');
  });
});
