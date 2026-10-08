// Build the signed Android release of the current commit as a Muse-account
// app, and with --publish put it on the two download mirrors the website
// links to.
//
// Usage: npm run android:release [-- --publish]
//
// The commit is cloned into .build/android-release/<commit>, so uncommitted
// changes in the worktree never reach the package. The APK lands in
// .build/android/. The three public account build values come from
// scripts/account-config.mjs, as for the iPhone install.
//
// Required:
//   OPEN_MUSE_ANDROID_KEYSTORE           release keystore (alias "openmuse")
//   OPEN_MUSE_ANDROID_KEYSTORE_PASSWORD  its password
// For --publish:
//   the Volcengine CLI (`ve`) signed in, for the mainland China mirror on TOS
//   CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, for the R2 mirror
// Optional:
//   JAVA_HOME  a JDK 21 or newer
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
// Where releases are downloaded from: TOS in Beijing for mainland China and
// R2 everywhere else (see site/worker.js).
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

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
}

const keystore = process.env.OPEN_MUSE_ANDROID_KEYSTORE;
if (!keystore || !process.env.OPEN_MUSE_ANDROID_KEYSTORE_PASSWORD)
  fail(
    "Set OPEN_MUSE_ANDROID_KEYSTORE and OPEN_MUSE_ANDROID_KEYSTORE_PASSWORD to the release keystore.",
  );
if (!existsSync(keystore)) fail(`No keystore at ${keystore}.`);
if (
  publish &&
  !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
)
  fail("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to publish.");

const commit = read("git", ["rev-parse", "HEAD"]);
const short = commit.slice(0, 7);
// One more for every commit on the branch, so each release installs over
// the one before it.
const versionCode = read("git", ["rev-list", "--count", commit]);
const versionName = /versionName "([^"]+)"/.exec(
  readFileSync(path.join(root, "android/app/build.gradle"), "utf8"),
)?.[1];
if (!versionName) fail("android/app/build.gradle names no versionName.");
const sdk =
  process.env.ANDROID_HOME ||
  /^sdk\.dir=(.+)$/m.exec(
    readFileSync(path.join(root, "android/local.properties"), "utf8"),
  )?.[1];
if (!sdk) fail("Set ANDROID_HOME to the Android SDK.");

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step(`Checking out ${short} (version ${versionName}, code ${versionCode})`);
const work = path.join(root, ".build/android-release", short);
rmSync(work, { recursive: true, force: true });
mkdirSync(path.dirname(work), { recursive: true });
run("git", ["clone", "--shared", "--quiet", root, work]);
run("git", ["checkout", "--quiet", "--detach", commit], { cwd: work });
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"));

step("Building the web bundle with Open Muse accounts");
run("npm", ["run", "build"], { cwd: work, env: accountBuildEnv(config) });
run(path.join(root, "node_modules/.bin/cap"), ["sync", "android"], {
  cwd: work,
});

step("Building the signed release");
run("./gradlew", ["assembleRelease", "-q"], {
  cwd: path.join(work, "android"),
  env: {
    ...process.env,
    ANDROID_HOME: sdk,
    OPEN_MUSE_ANDROID_VERSION_CODE: versionCode,
  },
});
const built = path.join(
  work,
  "android/app/build/outputs/apk/release/app-release.apk",
);
const tools = path.join(sdk, "build-tools");
const apksigner = read("ls", [tools])
  .split("\n")
  .sort()
  .map((version) => path.join(tools, version, "apksigner"))
  .filter(existsSync)
  .pop();
if (!apksigner) fail("No apksigner in the Android SDK build tools.");
run(apksigner, ["verify", built]);

const file = `OpenMuse-${versionName}-${versionCode}.apk`;
const out = path.join(root, ".build/android", file);
mkdirSync(path.dirname(out), { recursive: true });
copyFileSync(built, out);
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
const size = statSync(out).size;
console.log(`\n${path.relative(root, out)}  ${size} bytes  sha256 ${sha256}`);

if (!publish) process.exit(0);

const type = "application/vnd.android.package-archive";
step("Uploading to the mainland China mirror (TOS)");
run("ve", [
  "ve-tos-cli",
  "cp",
  out,
  `tos://${mirrors.cn.bucket}/android/${file}`,
  "--acl",
  "public-read",
  "--content-type",
  type,
  "--auth-mode",
  "unified",
  "--region",
  mirrors.cn.region,
  "--endpoint",
  mirrors.cn.endpoint,
  "--no-progress",
]);

step("Uploading to the global mirror (R2)");
run("npx", [
  "wrangler",
  "r2",
  "object",
  "put",
  `${mirrors.global.bucket}/android/${file}`,
  "--file",
  out,
  "--content-type",
  type,
  "--remote",
]);

step("Checking both mirrors");
for (const mirror of Object.values(mirrors)) {
  const response = await fetch(`${mirror.base}/android/${file}`, {
    method: "HEAD",
  });
  if (!response.ok)
    fail(`${mirror.base} answers ${response.status} for the new release.`);
  console.log(`${mirror.base}: ${response.status}`);
}

writeFileSync(
  downloadsFile,
  `${JSON.stringify(
    {
      android: {
        version: versionName,
        versionCode: Number(versionCode),
        commit: short,
        file,
        size,
        sha256,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  `\nUpdated ${path.relative(root, downloadsFile)}. Commit it, then deploy the website (node site/deploy.mjs).`,
);
