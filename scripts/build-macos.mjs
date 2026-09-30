import { execFileSync } from "node:child_process";
import { mkdir, copyFile, cp, mkdtemp, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "..");
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
execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
const destination = path.join(output, "Open Muse.app");
try {
  await rename(destination, path.join(staging, "Previous Open Muse.app"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rename(app, destination);
console.log(`Built ${destination}`);
