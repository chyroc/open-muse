// Builds the getopenmuse.com website twice from site/public:
//
// - .build/site, served by Cloudflare at getopenmuse.com, whose Worker
//   (site/worker.js) sends visitors from mainland China to the mirror and
//   each Android download to the nearer of two mirrors;
// - .build/site-cn, the mirror at cn.getopenmuse.com, served from Hong Kong
//   by Alibaba Cloud, which links its Android download directly.
//
// Both get the README screenshots from docs/images as smaller WebP files,
// the app icons, and the current Android release from site/downloads.json.
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
const { android } = JSON.parse(
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

const releaseURL = (mirror) => `${mirror.base}/android/${android.file}`;
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
  const values = {
    "android.link": cn ? `/android/${android.file}` : "/download/android",
    "android.cn": releaseURL(mirrors.cn),
    "android.global": releaseURL(mirrors.global),
    "android.version": android.version,
    "android.size": `${(android.size / 1048576).toFixed(1)} MB`,
    "android.sha256": android.sha256,
    "mirror.switch.en": cn
      ? `<a href="${site}/?mirror=global">Global site</a>`
      : `<a href="${mirrors.cn.base}/">Mainland China mirror</a>`,
    "mirror.switch.zh": cn
      ? `<a href="${site}/zh/?mirror=global">海外站点</a>`
      : `<a href="${mirrors.cn.base}/zh/">中国大陆镜像</a>`,
  };
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
