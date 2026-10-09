// getopenmuse.com in front of its static pages (.build/site).
//
// Cloudflare is slow to reach from mainland China, so visitors there are
// sent to the same pages on the mirror at cn.getopenmuse.com, served from
// Hong Kong by Alibaba Cloud; ?mirror=global keeps someone on this site and
// is remembered in a cookie. /download/android and /download/macos send each
// visitor to the current release on the nearer mirror: Alibaba Cloud for
// mainland China, Cloudflare R2 everywhere else (?mirror=cn or ?mirror=global
// picks one), and /download/macos.json tells the Mac app about the current
// release.
import downloads from "./downloads.json";
import mirrors from "./mirrors.json";

const year = 365 * 24 * 60 * 60;

function chosenMirror(request, url) {
  const asked = url.searchParams.get("mirror");
  if (asked === "cn" || asked === "global") return asked;
  if (
    /(?:^|;\s*)mirror=global(?:;|$)/.test(request.headers.get("Cookie") ?? "")
  )
    return "global";
  return request.cf?.country === "CN" ? "cn" : "global";
}

function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mirror = chosenMirror(request, url);

    // The Mac app's update check: the current release, from the nearer mirror.
    if (url.pathname === "/download/macos.json" && downloads.macos) {
      const { version, build, size, sha256, file } = downloads.macos;
      return Response.json(
        {
          version,
          build,
          size,
          sha256,
          url: `${mirrors[mirror].base}/macos/${file}`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const platform = /^\/download\/(android|macos)$/.exec(url.pathname)?.[1];
    if (platform && downloads[platform])
      return redirect(
        `${mirrors[mirror].base}/${platform}/${downloads[platform].file}`,
      );

    const page =
      request.method === "GET" &&
      (request.headers.get("Accept") ?? "").includes("text/html");
    if (page && mirror === "cn" && !url.searchParams.has("mirror"))
      return redirect(`${mirrors.cn.base}${url.pathname}${url.search}`);

    const response = await env.ASSETS.fetch(request);
    if (url.searchParams.get("mirror") !== "global") return response;
    // Stay on this site from now on.
    const kept = new Response(response.body, response);
    kept.headers.append(
      "Set-Cookie",
      `mirror=global; Path=/; Max-Age=${year}; Secure; SameSite=Lax`,
    );
    return kept;
  },
};
