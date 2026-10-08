// Build the Mac app of the current commit for distribution outside the App
// Store: signed with Developer ID under the hardened runtime, notarized by
// Apple, and packed in a notarized disk image. With --publish the image goes
// to the two download mirrors the website links to.
//
// Usage: npm run macos:release [-- --publish]
//
// The commit is cloned into .build/macos-release/<commit>, so uncommitted
// changes never reach the release; the disk image lands in .build/macos/.
// The build number is the number of commits on the branch.
//
// Required:
//   OPEN_MUSE_MAC_P12           Developer ID Application identity (.p12)
//   OPEN_MUSE_MAC_P12_PASSWORD  its password
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH  App Store Connect API key, for
//                               notarization
// For --publish, as for npm run android:release:
//   the Alibaba Cloud CLI (`aliyun`) signed in (ALIYUN_PROFILE selects a
//   profile), and CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const publish = process.argv.includes("--publish");
const mirrors = JSON.parse(
  readFileSync(path.join(root, "site/mirrors.json"), "utf8"),
);
const downloadsFile = path.join(root, "site/downloads.json");

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

const p12 = process.env.OPEN_MUSE_MAC_P12;
const p12Password = process.env.OPEN_MUSE_MAC_P12_PASSWORD;
if (!p12 || !p12Password || !existsSync(p12))
  fail("Set OPEN_MUSE_MAC_P12 and OPEN_MUSE_MAC_P12_PASSWORD.");
const ascKey = {
  id: process.env.ASC_KEY_ID,
  issuer: process.env.ASC_ISSUER_ID,
  file: process.env.ASC_KEY_PATH,
};
if (!ascKey.id || !ascKey.issuer || !ascKey.file || !existsSync(ascKey.file))
  fail("Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH for notarization.");
if (
  publish &&
  !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
)
  fail("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to publish.");

const commit = read("git", ["rev-parse", "HEAD"]);
const short = commit.slice(0, 7);
const build = read("git", ["rev-list", "--count", commit]);
const version = read("plutil", [
  "-extract",
  "CFBundleShortVersionString",
  "raw",
  "macos/Info.plist",
]);

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step(`Checking out ${short} (version ${version}, build ${build})`);
const work = path.join(root, ".build/macos-release", short);
rmSync(work, { recursive: true, force: true });
mkdirSync(path.dirname(work), { recursive: true });
run("git", ["clone", "--shared", "--quiet", root, work]);
run("git", ["checkout", "--quiet", "--detach", commit], { cwd: work });
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"));
symlinkSync(
  path.join(root, "macos/node_modules"),
  path.join(work, "macos/node_modules"),
);
run(
  "plutil",
  ["-replace", "CFBundleVersion", "-string", build, "macos/Info.plist"],
  {
    cwd: work,
  },
);
// The clone's only change is the build number, which the app does not show
// as a modification; keep its version the clean commit.
run("git", ["update-index", "--assume-unchanged", "macos/Info.plist"], {
  cwd: work,
});

step("Building the Mac app with Open Muse accounts");
run("npm", ["run", "macos:build"], { cwd: work, env: accountBuildEnv(config) });
const app = path.join(work, ".build/macos/Open Muse.app");

// A keychain of its own holds the identity only while this runs.
const scratch = mkdtempSync(path.join(os.tmpdir(), "open-muse-release-"));
const keychain = path.join(scratch, "release.keychain-db");
const keychainPassword = randomBytes(24).toString("base64");
const out = path.join(root, ".build/macos");
mkdirSync(out, { recursive: true });
const file = `OpenMuse-${version}-${build}.dmg`;
const dmg = path.join(out, file);
try {
  step("Signing with Developer ID");
  run("security", ["create-keychain", "-p", keychainPassword, keychain]);
  run("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
  run("security", [
    "import",
    p12,
    "-k",
    keychain,
    "-P",
    p12Password,
    "-T",
    "/usr/bin/codesign",
  ]);
  execFileSync(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ],
    { stdio: "ignore" },
  );
  const identity = /"(Developer ID Application: [^"]+)"/.exec(
    read("security", ["find-identity", "-v", "-p", "codesigning", keychain]),
  )?.[1];
  if (!identity) fail("The .p12 holds no Developer ID Application identity.");
  const sign = (target, extra = []) =>
    run("codesign", [
      "--force",
      "--timestamp",
      "--sign",
      identity,
      "--keychain",
      keychain,
      ...extra,
      target,
    ]);
  sign(app, [
    "--options",
    "runtime",
    "--entitlements",
    path.join(work, "macos/OpenMuse.entitlements"),
  ]);
  run("codesign", ["--verify", "--strict", "--deep", app]);

  const notarize = (target) => {
    const result = JSON.parse(
      read("xcrun", [
        "notarytool",
        "submit",
        target,
        "--key",
        ascKey.file,
        "--key-id",
        ascKey.id,
        "--issuer",
        ascKey.issuer,
        "--wait",
        "--output-format",
        "json",
      ]),
    );
    if (result.status !== "Accepted")
      fail(
        `Notarization of ${path.basename(target)} ended ${result.status} (submission ${result.id}).`,
      );
  };

  step("Notarizing the app");
  const zip = path.join(scratch, "Open Muse.zip");
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  notarize(zip);
  run("xcrun", ["stapler", "staple", app]);

  step("Packing and notarizing the disk image");
  const stage = path.join(scratch, "image");
  mkdirSync(stage);
  run("ditto", [app, path.join(stage, "Open Muse.app")]);
  symlinkSync("/Applications", path.join(stage, "Applications"));
  rmSync(dmg, { force: true });
  run("hdiutil", [
    "create",
    "-volname",
    "Open Muse",
    "-srcfolder",
    stage,
    "-fs",
    "HFS+",
    "-format",
    "UDZO",
    "-quiet",
    dmg,
  ]);
  sign(dmg);
  notarize(dmg);
  run("xcrun", ["stapler", "staple", dmg]);
  run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose",
    dmg,
  ]);
} finally {
  execFileSync("security", ["delete-keychain", keychain], { stdio: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
}

const sha256 = createHash("sha256").update(readFileSync(dmg)).digest("hex");
const size = statSync(dmg).size;
console.log(`\n${path.relative(root, dmg)}  ${size} bytes  sha256 ${sha256}`);

if (!publish) process.exit(0);

const type = "application/x-apple-diskimage";
step("Uploading to the mainland China mirror (Alibaba Cloud OSS)");
run("aliyun", [
  "ossutil",
  "cp",
  dmg,
  `oss://${mirrors.cn.bucket}/macos/${file}`,
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
  `${mirrors.global.bucket}/macos/${file}`,
  "--file",
  dmg,
  "--content-type",
  type,
  "--remote",
]);

step("Checking both mirrors");
for (const mirror of Object.values(mirrors)) {
  const response = await fetch(`${mirror.base}/macos/${file}`, {
    method: "HEAD",
  });
  if (!response.ok)
    fail(`${mirror.base} answers ${response.status} for the new release.`);
  console.log(`${mirror.base}: ${response.status}`);
}

const downloads = JSON.parse(readFileSync(downloadsFile, "utf8"));
downloads.macos = {
  version,
  build: Number(build),
  commit: short,
  file,
  size,
  sha256,
};
writeFileSync(downloadsFile, `${JSON.stringify(downloads, null, 2)}\n`);
console.log(
  `\nUpdated ${path.relative(root, downloadsFile)}. Commit it, then deploy the website (node site/deploy.mjs).`,
);
