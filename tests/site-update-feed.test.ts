import { describe, expect, it } from "vitest";
import worker from "../site/worker.js";
import { updateFeeds } from "../site/feeds.js";
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

describe("App update feeds", () => {
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
  it("names the Android release by its version code on the nearer mirror", async () => {
    const { version, versionCode, size, sha256, file } = downloads.android;
    for (const [country, mirror] of [
      ["CN", mirrors.cn],
      ["US", mirrors.global],
    ] as const)
      expect(
        await (await ask("/download/android.json", country)).json(),
      ).toEqual({
        version,
        build: versionCode,
        size,
        sha256,
        url: `${mirror.base}/android/${file}`,
      });
  });
  it("points the iPhone app at TestFlight", async () => {
    const { version, build, testflight } = downloads.ios;
    expect(await (await ask("/download/ios.json", "US")).json()).toEqual({
      version,
      build,
      url: testflight,
    });
    expect(testflight).toMatch(/^https:\/\/testflight\.apple\.com\/join\//);
  });
  it("carries the Windows release's signature on the given mirror", () => {
    const windows = {
      version: "20261014-0000000",
      build: 600,
      commit: "0000000",
      file: "OpenMuse-20261014-0000000.zip",
      size: 1,
      sha256: "0".repeat(64),
      signature: "c2lnbmF0dXJl",
    };
    expect(updateFeeds({ windows }, mirrors.cn).windows).toEqual({
      version: windows.version,
      build: windows.build,
      size: 1,
      sha256: windows.sha256,
      signature: windows.signature,
      url: `${mirrors.cn.base}/windows/${windows.file}`,
    });
  });
  it("answers only the known feeds", async () => {
    expect(await (await ask("/download/linux.json", "US")).text()).toBe(
      "asset",
    );
  });
});
