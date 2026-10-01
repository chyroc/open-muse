import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Mac acceptance profile", () => {
  it("keeps a named profile's credentials and web data apart", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    // Only a short lowercase name is accepted from the command line.
    expect(swift).toContain('"^[a-z0-9-]{1,32}$"');
    expect(swift).toContain(
      'let service = profile.map { "\\(base).profile.\\($0)" } ?? base',
    );
    expect(swift).toContain(
      "configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: id)",
    );
  });
});
