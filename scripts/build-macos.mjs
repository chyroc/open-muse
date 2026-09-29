import { execFileSync } from "node:child_process";
import { mkdir, copyFile, cp } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, ".build/macos/Open Muse.app");
const contents = path.join(app, "Contents");
const resources = path.join(contents, "Resources");
await mkdir(path.join(contents, "MacOS"), { recursive: true });
await mkdir(path.join(resources, "app"), { recursive: true });
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
await copyFile(process.execPath, path.join(resources, "node"));
await build({
  entryPoints: [path.join(root, "server/native.ts")],
  outfile: path.join(resources, "app/server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["fsevents"],
  logLevel: "warning",
});
await cp(path.join(root, "dist"), path.join(resources, "app/dist"), {
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
execFileSync(
  "codesign",
  ["--force", "--sign", "-", path.join(resources, "node")],
  { stdio: "inherit" },
);
execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
console.log(`Built ${app}`);
