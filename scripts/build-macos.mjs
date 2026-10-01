import { execFileSync } from "node:child_process";
import {
  mkdir,
  copyFile,
  cp,
  mkdtemp,
  rename,
  writeFile,
} from "node:fs/promises";
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
    path.join(root, "macos/OpenMuse.swift"),
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
// keeps the Accessibility and Screen Recording grants too. Set
// OPEN_MUSE_SIGN_IDENTITY to choose one; otherwise the first Apple Development
// identity in the login keychain is used, and ad-hoc signing is the fallback.
function signingIdentity() {
  if (process.env.OPEN_MUSE_SIGN_IDENTITY)
    return process.env.OPEN_MUSE_SIGN_IDENTITY;
  try {
    const found = execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { encoding: "utf8" },
    );
    return /"(Apple Development: [^"]+)"/.exec(found)?.[1] ?? "-";
  } catch {
    return "-";
  }
}
function sign(identity) {
  execFileSync("codesign", ["--force", "--sign", identity, app], {
    stdio: identity === "-" ? "inherit" : "pipe",
  });
}
const identity = signingIdentity();
let stable = false;
if (identity !== "-")
  try {
    sign(identity);
    stable = true;
  } catch {
    // A remote shell cannot use a key in a locked login keychain.
  }
if (!stable) sign("-");
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
