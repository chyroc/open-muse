import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { BackgroundSettings } from "../src/BackgroundSettings";
import { BackgroundClient } from "../src/background-client";

describe("Background connection UI", () => {
  it("does not claim background capability on an unconfigured build", () => {
    const html = renderToStaticMarkup(
      <BackgroundSettings service={new BackgroundClient("")} />,
    );
    expect(html).toContain("no background service configured");
    expect(html).not.toContain('type="password"');
  });
  it("uses a private device token and explains local removal versus server scheduling", () => {
    const html = renderToStaticMarkup(
      <BackgroundSettings
        service={new BackgroundClient("https://background.example")}
      />,
    );
    expect(html).toContain("Device token");
    expect(html).toContain('type="password"');
    expect(html).toContain("never an Ark key or Cloudflare token");
    expect(html).toContain("Pause the schedule before disconnecting");
  });
});
