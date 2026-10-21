// Builds the Windows app: the Mac app's web UI (the same bundle, see
// scripts/build-macos.mjs) inside the WPF/WebView2 shell in windows/, as a
// self-contained win-x64 folder zipped to .build/windows/OpenMuse-<version>.zip.
//
// Usage: npm run windows:build
//
// The web bundle, native strings, version and icon are prepared here on any
// system. The .NET part needs Windows: run on Windows it builds locally;
// elsewhere set OPEN_MUSE_WINDOWS_HOST (user@host) to a Windows machine with
// the .NET 8 SDK reachable over SSH (OPEN_MUSE_WINDOWS_KEY names the key), and
// the source is built there and the zip brought back (OPEN_MUSE_WINDOWS_PORT
// sets a non-default SSH port).
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { editorLicenseNotices } from "../macos/tools/licenses.mjs";
import { accountConfig } from "./account-config.mjs";
import { buildCommit, releaseVersion } from "./build-commit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".build/windows");
const stage = path.join(out, "stage");

function step(message) {
  console.log(`\n==> ${message}`);
}
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}
const read = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

// Always an Open Muse account build, as on the Mac.
const account = accountConfig();
process.env.VITE_MUSE_BACKGROUND_URL = account.background;
process.env.VITE_MUSE_SUPABASE_URL = account.auth;
process.env.VITE_MUSE_SUPABASE_ANON_KEY = account.anonKey;

step("Building the web bundle with Open Muse accounts");
run(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"),
  "--project",
  path.join(root, "macos/tsconfig.json"),
]);
run(process.execPath, [
  path.join(root, "node_modules/vite/bin/vite.js"),
  "build",
  "--config",
  path.join(root, "macos/vite.config.ts"),
]);
if (
  !readFileSync(path.join(root, ".build/macos-ui/index.html"), "utf8").includes(
    new URL(account.auth).origin,
  )
)
  throw new Error("The bundle does not include the account service.");

step("Preparing the web app, strings, version and icon");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, ".build/macos-ui"), path.join(stage, "web"), {
  recursive: true,
});
await writeFile(
  path.join(stage, "web", "notices.txt"),
  `${await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8")}\n${await editorLicenseNotices(root)}`,
);
// Native text comes from the Mac app's catalogs, so both shells share one.
await mkdir(path.join(stage, "strings"), { recursive: true });
for (const language of ["en", "zh-Hans"]) {
  const source = await readFile(
    path.join(root, "macos", `${language}.lproj`, "Localizable.strings"),
    "utf8",
  );
  await writeFile(
    path.join(stage, "strings", `${language}.json`),
    JSON.stringify(parseStrings(source), null, 1),
  );
}
const commit = buildCommit(root);
const version = commit
  ? releaseVersion("HEAD", root)
  : `development-${os.hostname()}`;
const build = commit ? Number(read("git", ["rev-list", "--count", "HEAD"])) : 0;
await writeFile(
  path.join(stage, "version.json"),
  `${JSON.stringify({ version, build, commit: commit ?? "" })}\n`,
);
await writeIcon(path.join(stage, "OpenMuse.ico"));
const zip = path.join(out, `OpenMuse-${version}.zip`);

if (process.platform === "win32") {
  step("Building the Windows shell");
  await cp(
    path.join(stage, "OpenMuse.ico"),
    path.join(root, "windows/OpenMuse.App/OpenMuse.ico"),
  );
  const publish = path.join(out, "OpenMuse");
  await rm(publish, { recursive: true, force: true });
  run("dotnet", [
    "publish",
    path.join(root, "windows/OpenMuse.App/OpenMuse.App.csproj"),
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "-p:PublishSingleFile=false",
    "-p:DebugType=none",
    "-o",
    publish,
  ]);
  await cp(stage, publish, { recursive: true });
  await rm(zip, { force: true });
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${publish}\\*' -DestinationPath '${zip}'`,
  ]);
} else {
  const host = process.env.OPEN_MUSE_WINDOWS_HOST;
  if (!host)
    throw new Error(
      "Building the Windows shell needs Windows: set OPEN_MUSE_WINDOWS_HOST to a Windows machine with the .NET 8 SDK.",
    );
  const key = process.env.OPEN_MUSE_WINDOWS_KEY;
  const ssh = [
    ...(key ? ["-i", key] : []),
    ...(process.env.OPEN_MUSE_WINDOWS_PORT
      ? ["-o", `Port=${process.env.OPEN_MUSE_WINDOWS_PORT}`]
      : []),
    ...(process.env.OPEN_MUSE_WINDOWS_KNOWN_HOSTS
      ? [
          "-o",
          `UserKnownHostsFile=${process.env.OPEN_MUSE_WINDOWS_KNOWN_HOSTS}`,
        ]
      : []),
    "-o",
    "ConnectTimeout=20",
  ];
  step(`Building the Windows shell on ${host.replace(/^.*@/, "")}`);
  const archive = path.join(out, "source.tgz");
  run("tar", [
    "--exclude",
    "bin",
    "--exclude",
    "obj",
    "-czf",
    archive,
    "windows",
    "-C",
    out,
    "stage",
  ]);
  const remote = "C:\\open-muse-build";
  run("ssh", [
    ...ssh,
    host,
    `if (Test-Path ${remote}) { Remove-Item ${remote} -Recurse -Force }; New-Item -ItemType Directory ${remote} | Out-Null`,
  ]);
  run("scp", [
    ...ssh,
    archive,
    `${host}:${remote.replaceAll("\\", "/")}/source.tgz`,
  ]);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location ${remote}`,
    "tar -xzf source.tgz",
    "Copy-Item stage\\OpenMuse.ico windows\\OpenMuse.App\\OpenMuse.ico",
    "dotnet test windows\\OpenMuse.Core.Tests --nologo -v q",
    "if ($LASTEXITCODE) { exit $LASTEXITCODE }",
    "dotnet publish windows\\OpenMuse.App\\OpenMuse.App.csproj -c Release -r win-x64 --self-contained -p:DebugType=none -o publish --nologo -v q",
    "if ($LASTEXITCODE) { exit $LASTEXITCODE }",
    "Copy-Item stage\\* publish -Recurse -Force",
    "Compress-Archive -Path publish\\* -DestinationPath app.zip -Force",
  ].join("; ");
  run("ssh", [...ssh, host, script]);
  run("scp", [...ssh, `${host}:${remote.replaceAll("\\", "/")}/app.zip`, zip]);
}
console.log(`\nBuilt ${path.relative(root, zip)}`);

// A Localizable.strings file as a key-to-text object.
function parseStrings(source) {
  const table = {};
  const pattern = /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm;
  const unescape = (text) => JSON.parse(`"${text}"`);
  for (const [, key, value] of source.matchAll(pattern))
    table[unescape(key)] = unescape(value);
  return table;
}

// The app icon from public/icon.svg, as a .ico holding PNG images.
async function writeIcon(file) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(path.join(root, "public/icon.svg")).resize(size).png().toBuffer(),
    ),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(file);
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.write(header);
    for (const image of images) stream.write(image);
    stream.end();
  });
}

if (!existsSync(zip)) process.exitCode = 1;
