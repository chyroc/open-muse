// Builds the getopenmuse.com website twice from site/public:
//
// - .build/site, served by Cloudflare at getopenmuse.com, whose Worker
//   (site/worker.js) sends visitors from mainland China to the mirror and
//   each Android or Mac download to the nearer of two mirrors;
// - .build/site-cn, the mirror at cn.getopenmuse.com, served from Hong Kong
//   by Alibaba Cloud, which links its downloads directly.
//
// Both get the README screenshots from docs/images as smaller WebP files,
// the app icons, and the current Android and Mac releases from
// site/downloads.json, with the Mac release also at /download/macos.json
// for the app's own update check.
// The screenshots are converted at build time so the repository keeps one
// copy of each.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const mirrors = JSON.parse(
  readFileSync(path.join(root, "site/mirrors.json"), "utf8"),
);
const downloads = JSON.parse(
  readFileSync(path.join(root, "site/downloads.json"), "utf8"),
);
const site = "https://getopenmuse.com";

// Screenshots are shown at most a few hundred pixels wide.
const images = path.join(root, ".build/site-images");
rmSync(images, { recursive: true, force: true });
mkdirSync(images, { recursive: true });
for (const file of readdirSync(path.join(root, "docs/images"))) {
  if (!file.endsWith(".png")) continue;
  await sharp(path.join(root, "docs/images", file))
    .resize({ width: 900, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(images, file.replace(/\.png$/, ".webp")));
}

const megabytes = (size) => `${(size / 1048576).toFixed(1)} MB`;

// The repository's star count for the Star buttons, read once per build so
// visitors never call GitHub; without it the buttons show no count.
// GITHUB_TOKEN, when set, avoids GitHub's anonymous rate limit.
async function starCount() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/chyroc/open-muse",
      {
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(15_000),
      },
    );
    const { stargazers_count: stars } = await response.json();
    return Number.isInteger(stars) ? stars.toLocaleString("en-US") : "";
  } catch {
    return "";
  }
}
const stars = await starCount();
if (!stars) console.warn("The GitHub star count could not be read.");
const html = (directory) =>
  readdirSync(directory, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".html"));

function build(out, cn) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(path.join(root, "site/public"), out, { recursive: true });
  cpSync(images, path.join(out, "images"), { recursive: true });
  for (const icon of ["icon-192.png", "icon-512.png", "icon.svg"])
    cpSync(path.join(root, "public", icon), path.join(out, icon));
  const values = {};
  for (const [platform, release] of Object.entries(downloads)) {
    const file = `${platform}/${release.file}`;
    Object.assign(values, {
      [`${platform}.link`]: cn ? `/${file}` : `/download/${platform}`,
      [`${platform}.cn`]: `${mirrors.cn.base}/${file}`,
      [`${platform}.global`]: `${mirrors.global.base}/${file}`,
      [`${platform}.version`]: release.version,
      [`${platform}.size`]: megabytes(release.size),
      [`${platform}.sha256`]: release.sha256,
    });
  }
  Object.assign(values, {
    "github.stars": stars,
    "mirror.switch.en": cn
      ? `<a href="${site}/?mirror=global">Global site</a>`
      : `<a href="${mirrors.cn.base}/">Mainland China mirror</a>`,
    "mirror.switch.zh": cn
      ? `<a href="${site}/zh/?mirror=global">海外站点</a>`
      : `<a href="${mirrors.cn.base}/zh/">中国大陆镜像</a>`,
  });
  // The Mac app checks this for updates. On the main site the Worker answers
  // instead, naming the nearer mirror.
  if (downloads.macos) {
    const { version, build: number, size, sha256, file } = downloads.macos;
    const mirror = cn ? mirrors.cn : mirrors.global;
    mkdirSync(path.join(out, "download"), { recursive: true });
    writeFileSync(
      path.join(out, "download/macos.json"),
      `${JSON.stringify({ version, build: number, size, sha256, url: `${mirror.base}/macos/${file}` })}\n`,
    );
  }
  for (const file of html(out)) {
    const page = path.join(out, file);
    let text = readFileSync(page, "utf8")
      .replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
        if (!(key in values)) throw new Error(`${file}: unknown ${match}`);
        return values[key];
      })
      .replace(/(\/images\/[\w-]+)\.png/g, "$1.webp");
    // The mirror points search engines at the main site.
    if (cn) {
      const where = `/${file.replace(/index\.html$/, "")}`;
      text = text.replace(
        "</head>",
        `<link rel="canonical" href="${site}${where}">\n</head>`,
      );
    }
    writeFileSync(page, text);
  }
}

build(path.join(root, ".build/site"), false);
build(path.join(root, ".build/site-cn"), true);
console.log("Built .build/site and .build/site-cn");
