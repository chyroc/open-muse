// Builds the website and publishes both copies: the mainland China mirror to
// Alibaba Cloud OSS behind the cn.getopenmuse.com CDN, then the main site to
// Cloudflare.
//
// Usage: node site/deploy.mjs
//
// Requires the Alibaba Cloud CLI (`aliyun`) signed in to the account that
// owns the mirror (ALIYUN_PROFILE selects a profile), and
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for Cloudflare.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mirrors = JSON.parse(
  readFileSync(path.join(root, "site/mirrors.json"), "utf8"),
);
const profile = process.env.ALIYUN_PROFILE
  ? ["--profile", process.env.ALIYUN_PROFILE]
  : [];

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

run("node", ["site/build.mjs"]);

// Pages are checked again after five minutes; images and styles after a day.
// Released APKs under android/ are left as they are.
const bucket = `oss://${mirrors.cn.bucket}/`;
const upload = (include, cacheControl) =>
  run("aliyun", [
    "ossutil",
    "cp",
    "-r",
    "-f",
    ".build/site-cn/",
    bucket,
    "--include",
    include,
    "--acl",
    "public-read",
    "--cache-control",
    cacheControl,
    "--region",
    mirrors.cn.region,
    ...profile,
  ]);
upload("*.html", "public, max-age=300");
// The Mac app's update check reads download/macos.json.
upload("*.json", "public, max-age=300");
for (const pattern of ["*.webp", "*.png", "*.svg", "*.css"])
  upload(pattern, "public, max-age=86400");
run("aliyun", [
  "cdn",
  "RefreshObjectCaches",
  "--ObjectPath",
  `${mirrors.cn.base}/`,
  "--ObjectType",
  "Directory",
  ...profile,
]);

run("npx", ["wrangler", "deploy", "--config", "site/wrangler.jsonc"]);
