// What each app's update check reads, from site/downloads.json: the current
// release and where to get it. The Mac and Android downloads come from the
// given mirror; the iPhone app is updated through TestFlight, so its feed
// names the public TestFlight link. Shared by the build (static copies on
// both mirrors) and the Worker (which picks the nearer mirror).
export function updateFeeds(downloads, mirror) {
  const feeds = {};
  if (downloads.macos) {
    const { version, build, size, sha256, file } = downloads.macos;
    feeds.macos = {
      version,
      build,
      size,
      sha256,
      url: `${mirror.base}/macos/${file}`,
    };
  }
  if (downloads.android) {
    const { version, versionCode, size, sha256, file } = downloads.android;
    feeds.android = {
      version,
      build: versionCode,
      size,
      sha256,
      url: `${mirror.base}/android/${file}`,
    };
  }
  if (downloads.ios) {
    const { version, build, testflight } = downloads.ios;
    feeds.ios = { version, build, url: testflight };
  }
  return feeds;
}
