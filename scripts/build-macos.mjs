import { execFileSync } from "node:child_process";
import {
  mkdir,
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { editorLicenseNotices } from "../macos/tools/licenses.mjs";
import path from "node:path";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "..");
// Install the isolated editor dependencies with `npm ci --prefix macos`.
// The Mac workspace has its own entry point and never packages the mobile UI.
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "--project",
    path.join(root, "macos/tsconfig.json"),
  ],
  { stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    path.join(root, "macos/vite.config.ts"),
  ],
  { stdio: "inherit" },
);
const output = path.join(root, ".build/macos");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(path.join(output, "direct-build-"));
const app = path.join(staging, "Open Muse.app");
const contents = path.join(app, "Contents");
const resources = path.join(contents, "Resources");
await mkdir(path.join(contents, "MacOS"), { recursive: true });
await mkdir(resources, { recursive: true });
await writeFile(
  path.join(resources, "Editor-LICENSES.txt"),
  await editorLicenseNotices(root),
);
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-parse-as-library",
    "-O",
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
    "-framework",
    "AppKit",
    "-framework",
    "WebKit",
    "-framework",
    "Security",
    "-framework",
    "ServiceManagement",
    "-framework",
    "ScreenCaptureKit",
    "-framework",
    "AVFoundation",
    "-framework",
    "Speech",
    "-framework",
    "CoreAudio",
    "-framework",
    "AudioToolbox",
    "-framework",
    "EventKit",
    // Acceptance builds can include the snapshot tour; releases never do.
    ...(process.env.OPEN_MUSE_SNAPSHOT_TOUR === "1"
      ? ["-D", "SNAPSHOT_TOUR"]
      : []),
    path.join(root, "macos/OpenMuse.swift"),
    path.join(root, "macos/Computer.swift"),
    path.join(root, "macos/Dictation.swift"),
    path.join(root, "macos/LocalCalendar.swift"),
    "-o",
    path.join(contents, "MacOS/OpenMuse"),
  ],
  { stdio: "inherit" },
);
await copyFile(
  path.join(root, "macos/Info.plist"),
  path.join(contents, "Info.plist"),
);
for (const language of ["en", "zh-Hans"]) {
  await cp(
    path.join(root, "macos", `${language}.lproj`),
    path.join(resources, `${language}.lproj`),
    { recursive: true },
  );
}
await cp(path.join(root, ".build/macos-ui"), path.join(resources, "web"), {
  recursive: true,
});
// The Legal section shows the notices the app ships, from inside the bundle.
await writeFile(
  path.join(resources, "web", "notices.txt"),
  `${await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8")}\n${await editorLicenseNotices(root)}`,
);
const iconset = path.join(root, ".build/macos/AppIcon.iconset");
await mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2])
    await sharp(path.join(root, "public/icon.svg"))
      .resize(size * scale)
      .png()
      .toFile(
        path.join(
          iconset,
          `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
        ),
      );
}
execFileSync(
  "iconutil",
  ["-c", "icns", iconset, "-o", path.join(resources, "AppIcon.icns")],
  { stdio: "inherit" },
);
// Keychain trusts the app by its code signature. An ad-hoc signature changes
// with every build, so macOS asks for the Keychain password after each one.
// A stable signing identity keeps one "Always Allow" valid across builds, and
// keeps the Accessibility and Screen Recording grants too. The dedicated build
// keychain from scripts/macos-build-keychain.sh works from any shell; otherwise
// OPEN_MUSE_SIGN_IDENTITY or the first Apple Development identity in the login
// keychain is tried, and ad-hoc signing is the fallback.
const buildKeychain = path.join(
  os.homedir(),
  "Library/Keychains/open-muse-build.keychain-db",
);
const buildSecret = path.join(
  os.homedir(),
  ".config/open-muse/build-keychain-password",
);
function developmentIdentity(keychain) {
  try {
    const found = execFileSync(
      "security",
      [
        "find-identity",
        "-v",
        "-p",
        "codesigning",
        ...(keychain ? [keychain] : []),
      ],
      { encoding: "utf8" },
    );
    return /"(Apple Development: [^"]+)"/.exec(found)?.[1];
  } catch {
    return undefined;
  }
}
function signingOptions() {
  if (existsSync(buildKeychain) && existsSync(buildSecret)) {
    try {
      execFileSync(
        "security",
        [
          "unlock-keychain",
          "-p",
          readFileSync(buildSecret, "utf8").trim(),
          buildKeychain,
        ],
        { stdio: "pipe" },
      );
      const identity = developmentIdentity(buildKeychain);
      if (identity) return { identity, keychain: buildKeychain };
    } catch {
      // Fall through to the login keychain.
    }
  }
  const identity = process.env.OPEN_MUSE_SIGN_IDENTITY ?? developmentIdentity();
  return identity ? { identity } : undefined;
}
function sign(options) {
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      options?.identity ?? "-",
      ...(options?.keychain ? ["--keychain", options.keychain] : []),
      app,
    ],
    { stdio: options ? "pipe" : "inherit" },
  );
}
const options = signingOptions();
let stable = false;
if (options)
  try {
    sign(options);
    stable = true;
  } catch {
    // A remote shell cannot use a key in a locked login keychain.
  }
if (!stable) sign(undefined);
console.log(
  stable
    ? "Signed with a stable development identity."
    : "Signed ad hoc; macOS may ask for Keychain access after each build.",
);
const destination = path.join(output, "Open Muse.app");
try {
  await rename(destination, path.join(staging, "Previous Open Muse.app"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rename(app, destination);
console.log(`Built ${destination}`);
