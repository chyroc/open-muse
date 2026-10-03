// Build Open Muse as a Muse-account app and install it on a connected iPhone.
//
// Usage: npm run ios:install
//
// The three public account build values are resolved by
// scripts/account-config.mjs: from the environment, or with the Volcengine CLI.
//
// Optional settings:
//   OPEN_MUSE_DEVICE        device name, CoreDevice identifier, or UDID
//   DEVELOPMENT_TEAM        signing team (default: the Apple Development team)
//   OPEN_MUSE_CONFIGURATION Debug (default) or Release
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const configuration = process.env.OPEN_MUSE_CONFIGURATION || "Debug";
const derivedData = path.join(root, ".build/ios-device");

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

function read(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function pickDevice() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "open-muse-devices-"));
  const file = path.join(dir, "devices.json");
  try {
    read("xcrun", ["devicectl", "list", "devices", "--json-output", file]);
    const devices = JSON.parse(readFileSync(file, "utf8"))
      .result.devices.filter(
        (device) =>
          device.hardwareProperties?.platform === "iOS" &&
          device.hardwareProperties?.reality === "physical" &&
          device.connectionProperties?.pairingState === "paired",
      )
      .map((device) => ({
        id: device.identifier,
        udid: device.hardwareProperties.udid,
        name: device.deviceProperties?.name ?? device.identifier,
        model: device.hardwareProperties.marketingName ?? "",
      }));
    const wanted = process.env.OPEN_MUSE_DEVICE;
    const matches = wanted
      ? devices.filter((device) =>
          [device.id, device.udid, device.name].includes(wanted),
        )
      : devices;
    const list = devices
      .map((device) => `  ${device.name} (${device.model}) ${device.udid}`)
      .join("\n");
    if (matches.length === 0)
      fail(
        wanted
          ? `No paired iOS device matches "${wanted}". Paired devices:\n${list || "  (none)"}`
          : "No paired iPhone found. Connect it with a cable or on the same Wi-Fi, unlock it, and trust this Mac.",
      );
    if (matches.length > 1)
      fail(
        `Several devices are paired; set OPEN_MUSE_DEVICE to one of:\n${list}`,
      );
    return matches[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function signingTeam() {
  if (process.env.DEVELOPMENT_TEAM) return process.env.DEVELOPMENT_TEAM;
  const names = [
    ...read("security", ["find-identity", "-v", "-p", "codesigning"]).matchAll(
      /"(Apple Development: [^"]+)"/g,
    ),
  ].map((match) => match[1]);
  const teams = new Set();
  for (const name of names) {
    const pem = read("security", ["find-certificate", "-c", name, "-p"]);
    const subject = execFileSync(
      "openssl",
      ["x509", "-noout", "-subject", "-nameopt", "sep_multiline"],
      { input: pem, encoding: "utf8" },
    );
    const team = subject.match(/^\s*OU=(\w+)\s*$/m)?.[1];
    if (team) teams.add(team);
  }
  if (teams.size === 0)
    fail(
      "No Apple Development signing identity found. Sign in to Xcode with your Apple ID (Settings → Accounts) first.",
    );
  if (teams.size > 1)
    fail(
      `Several signing teams are available (${[...teams].join(", ")}); set DEVELOPMENT_TEAM.`,
    );
  return [...teams][0];
}

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step("Choosing the device and signing team");
const device = pickDevice();
const team = signingTeam();
console.log(`device: ${device.name} (${device.model}) ${device.udid}`);
console.log(`team:   ${team}`);

if (!existsSync(path.join(root, "node_modules"))) {
  step("Installing dependencies");
  run("npm", ["ci"]);
}

step("Building the web bundle with Open Muse accounts");
run("npm", ["run", "build"], { env: accountBuildEnv(config) });
if (
  !readFileSync(path.join(root, "dist/index.html"), "utf8").includes(
    new URL(config.auth).origin,
  )
)
  fail("The built bundle does not include the account service.");
run(path.join(root, "node_modules/.bin/cap"), ["sync", "ios"]);

step(`Building the iOS app (${configuration})`);
run("xcodebuild", [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  configuration,
  "-destination",
  `id=${device.udid}`,
  "-derivedDataPath",
  derivedData,
  "-allowProvisioningUpdates",
  `DEVELOPMENT_TEAM=${team}`,
  "CODE_SIGN_STYLE=Automatic",
  "build",
  "-quiet",
]);
const app = path.join(
  derivedData,
  `Build/Products/${configuration}-iphoneos/App.app`,
);
const bundleID = read("/usr/libexec/PlistBuddy", [
  "-c",
  "Print :CFBundleIdentifier",
  path.join(app, "Info.plist"),
]).trim();

step(`Installing on ${device.name}`);
run("xcrun", [
  "devicectl",
  "device",
  "install",
  "app",
  "--device",
  device.id,
  app,
]);

step("Launching");
try {
  run("xcrun", [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    device.id,
    "--terminate-existing",
    bundleID,
  ]);
} catch {
  console.warn(
    "Installed, but the app could not be launched. Unlock the iPhone and open Open Muse; on a first install, trust the developer in Settings → General → VPN & Device Management.",
  );
}

console.log(`
Done. In the app open Settings → Open Muse account to register or sign in with your
email, then connect your Ark API key. Apps signed by a free Personal Team expire
after 7 days; run this again to reinstall.`);
