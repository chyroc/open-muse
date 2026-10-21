// Build the Windows app of the current commit, sign the zip with the release
// key the app pins, and with --publish put it on the two download mirrors the
// website links to.
//
// Usage: npm run windows:release [-- --publish]
//
// The commit is cloned into .build/windows-release/<commit>, so uncommitted
// changes never reach the release; the zip lands in .build/windows/. The .NET
// part is built as scripts/build-windows.mjs describes (on Windows, or on the
// Windows machine OPEN_MUSE_WINDOWS_HOST names). The build number is the
// number of commits on the branch.
//
// Required:
//   OPEN_MUSE_WINDOWS_SIGNING_KEY  the release key (ECDSA P-256, PEM) whose
//                                  public half windows/OpenMuse.Core pins
// For --publish, as for npm run android:release:
//   the Alibaba Cloud CLI (`aliyun`) signed in (ALIYUN_PROFILE selects a
//   profile), and CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { releaseVersion } from "./build-commit.mjs";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const mirrors = JSON.parse(
  readFileSync(path.join(root, "site/mirrors.json"), "utf8"),
);
const downloadsFile = path.join(root, "site/downloads.json");
const publish = process.argv.includes("--publish");

function step(message) {
  console.log(`\n==> ${message}`);
}

function fail(message) {
  console.error(`\nerror: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

const read = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

const keyFile = process.env.OPEN_MUSE_WINDOWS_SIGNING_KEY;
if (!keyFile || !existsSync(keyFile))
  fail("Set OPEN_MUSE_WINDOWS_SIGNING_KEY to the Windows release key (PEM).");
const key = createPrivateKey(readFileSync(keyFile));
// The key must be the one the app checks, or no installed app would accept
// the update.
const pinned = /PublicKey =\s*"([^"]+)"/.exec(
  readFileSync(path.join(root, "windows/OpenMuse.Core/UpdateFeed.cs"), "utf8"),
)?.[1];
const publicKey = createPublicKey(key)
  .export({ type: "spki", format: "der" })
  .toString("base64");
if (publicKey !== pinned)
  fail("The signing key is not the release key the Windows app pins.");
if (
  publish &&
  !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
)
  fail("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to publish.");

const commit = read("git", ["rev-parse", "HEAD"]);
const short = commit.slice(0, 7);
const build = Number(read("git", ["rev-list", "--count", commit]));
const version = releaseVersion(commit, root);

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step(`Checking out ${short} (version ${version}, build ${build})`);
const work = path.join(root, ".build/windows-release", short);
rmSync(work, { recursive: true, force: true });
mkdirSync(path.dirname(work), { recursive: true });
run("git", ["clone", "--shared", "--quiet", root, work]);
run("git", ["checkout", "--quiet", "--detach", commit], { cwd: work });
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"));

run(process.execPath, [path.join(work, "scripts/build-windows.mjs")], {
  cwd: work,
  env: accountBuildEnv(config),
});

const file = `OpenMuse-${version}.zip`;
const built = path.join(work, ".build/windows", file);
if (!existsSync(built)) fail(`The build did not produce ${file}.`);
const out = path.join(root, ".build/windows", file);
mkdirSync(path.dirname(out), { recursive: true });
copyFileSync(built, out);
const data = readFileSync(out);
const sha256 = createHash("sha256").update(data).digest("hex");
const size = statSync(out).size;
// IEEE P1363 (r || s), the form the app verifies.
const signature = sign("sha256", data, {
  key,
  dsaEncoding: "ieee-p1363",
}).toString("base64");
console.log(`\n${path.relative(root, out)}  ${size} bytes  sha256 ${sha256}`);

if (!publish) process.exit(0);

const type = "application/zip";
step("Uploading to the mainland China mirror (Alibaba Cloud OSS)");
run("aliyun", [
  "ossutil",
  "cp",
  out,
  `oss://${mirrors.cn.bucket}/windows/${file}`,
  "--acl",
  "public-read",
  "--content-type",
  type,
  "--region",
  mirrors.cn.region,
  ...(process.env.ALIYUN_PROFILE
    ? ["--profile", process.env.ALIYUN_PROFILE]
    : []),
]);

step("Uploading to the global mirror (R2)");
run("npx", [
  "wrangler",
  "r2",
  "object",
  "put",
  `${mirrors.global.bucket}/windows/${file}`,
  "--file",
  out,
  "--content-type",
  type,
  "--remote",
]);

step("Checking both mirrors");
for (const mirror of Object.values(mirrors)) {
  const response = await fetch(`${mirror.base}/windows/${file}`, {
    method: "HEAD",
  });
  if (!response.ok)
    fail(`${mirror.base} answers ${response.status} for the new release.`);
  console.log(`${mirror.base}: ${response.status}`);
}

// The other releases are recorded in the same file and stay as they are.
const downloads = JSON.parse(readFileSync(downloadsFile, "utf8"));
downloads.windows = {
  version,
  build,
  commit: short,
  file,
  size,
  sha256,
  signature,
};
writeFileSync(downloadsFile, `${JSON.stringify(downloads, null, 2)}\n`);
console.log(
  `\nUpdated ${path.relative(root, downloadsFile)}. Commit it, then deploy the website (node site/deploy.mjs).`,
);
