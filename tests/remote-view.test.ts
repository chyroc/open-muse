import { describe, expect, it } from "vitest";
import {
  browserLaunchMessage,
  isBrowserLaunch,
  remoteViewDriver,
} from "../shared/remote-view";

describe("cloud browser helper", () => {
  it("asks the agent to start the helper once, quoting its arguments", () => {
    const text = browserLaunchMessage(
      "https://service.example/v1/browser/helper",
      "https://service.example/v1/browser/relay/0b4f3c4e-8a7d-4c1e-9f2a-6d5e4c3b2a10",
      "token-'with-quote_0123456789abcdef",
    );
    expect(isBrowserLaunch(text)).toBe(true);
    expect(isBrowserLaunch("Open the browser for me")).toBe(false);
    expect(text).toContain(
      "curl -fsS 'https://service.example/v1/browser/helper' -o /tmp/open-muse-remote-view.py && (nohup /opt/open-muse/python /tmp/open-muse-remote-view.py 'https://service.example/v1/browser/relay/0b4f3c4e-8a7d-4c1e-9f2a-6d5e4c3b2a10' 'token-with-quote_0123456789abcdef'",
    );
    expect(text).toContain("UNAVAILABLE");
    expect(text).toContain("Do not repeat, store or remember the token");
  });

  it("replays only known input", () => {
    for (const kind of ["click", "scroll", "text", "key", "navigate", "back"])
      expect(remoteViewDriver).toContain(`"${kind}"`);
    // It waits for the toolbox and stops when the view closes.
    expect(remoteViewDriver).toContain("toolbox_ready()");
    expect(remoteViewDriver).toContain('if not reply.get("open")');
  });
});
