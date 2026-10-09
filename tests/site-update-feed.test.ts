import { describe, expect, it } from "vitest";
import worker from "../site/worker.js";
import downloads from "../site/downloads.json";
import mirrors from "../site/mirrors.json";

function ask(path: string, country: string) {
  const request = Object.assign(new Request(`https://getopenmuse.com${path}`), {
    cf: { country },
  });
  return worker.fetch(request, {
    ASSETS: { fetch: async () => new Response("asset") },
  });
}

describe("Mac update feed", () => {
  it("names the current release on the nearer mirror", async () => {
    const { version, build, size, sha256, file } = downloads.macos;
    for (const [country, mirror] of [
      ["CN", mirrors.cn],
      ["US", mirrors.global],
    ] as const) {
      const response = await ask("/download/macos.json", country);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        version,
        build,
        size,
        sha256,
        url: `${mirror.base}/macos/${file}`,
      });
    }
    // The download link itself still redirects.
    expect((await ask("/download/macos", "US")).status).toBe(302);
  });
});
