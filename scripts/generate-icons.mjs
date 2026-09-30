import sharp from "sharp";
import { readFile, access, readdir } from "node:fs/promises";
const svg = await readFile(new URL("../public/icon.svg", import.meta.url));
for (const size of [192, 512])
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname);
try {
  const native = new URL(
    "../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
    import.meta.url,
  ).pathname;
  await access(native);
  await sharp(svg)
    .resize(1024, 1024)
    .flatten({ background: "#586443" })
    .png()
    .toFile(native);
} catch {
  /* Before the iOS project is generated, only the PWA icons are produced. */
}
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  const directory = new URL(
    `../android/app/src/main/res/mipmap-${density}/`,
    import.meta.url,
  ).pathname;
  try {
    await access(directory);
  } catch {
    continue;
  }
  for (const name of ["ic_launcher", "ic_launcher_round"])
    await sharp(svg).resize(size, size).png().toFile(`${directory}${name}.png`);
  const padded = Math.round(size * 2.25);
  const logo = await sharp(svg).resize(size, size).png().toBuffer();
  await sharp({
    create: {
      width: padded,
      height: padded,
      channels: 4,
      background: "#586443",
    },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(`${directory}ic_launcher_foreground.png`);
}

// Replace the splash images in the native templates; all visual assets come from this project's icon.
const splashTargets = [];
const iosSplash = new URL(
  "../ios/App/App/Assets.xcassets/Splash.imageset/",
  import.meta.url,
).pathname;
try {
  for (const file of await readdir(iosSplash))
    if (file.endsWith(".png")) splashTargets.push(iosSplash + file);
} catch {
  /* The project may not have been generated yet. */
}
const androidResources = new URL(
  "../android/app/src/main/res/",
  import.meta.url,
).pathname;
try {
  for (const directory of await readdir(androidResources)) {
    if (!directory.startsWith("drawable")) continue;
    const file = `${androidResources}${directory}/splash.png`;
    try {
      await access(file);
      splashTargets.push(file);
    } catch {
      /* Not a splash-image directory. */
    }
  }
} catch {
  /* The project may not have been generated yet. */
}
for (const target of splashTargets) {
  const { width, height } = await sharp(target).metadata();
  if (!width || !height) continue;
  const size = Math.round(Math.min(width, height) * 0.14);
  const mark = await sharp(svg).resize(size, size).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: "#f6f5f0" } })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(target);
}
