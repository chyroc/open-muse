import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { BackgroundSettings } from "../src/BackgroundSettings";
import { BackgroundClient } from "../src/background-client";

describe("Background connection UI", () => {
  it("does not claim background capability on a build without accounts", () => {
    for (const service of [
      new BackgroundClient(""),
      // A service origin alone no longer enables anything: background work
      // needs an Open Muse account.
      new BackgroundClient("https://background.example"),
    ]) {
      const html = renderToStaticMarkup(
        <BackgroundSettings service={service} />,
      );
      expect(html).toContain("this build has no account service");
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain("muse_device_");
    }
  });
});
