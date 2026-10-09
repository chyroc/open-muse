// Build Open Muse as a Muse-account app and install it on a connected Android
// phone.
//
// Usage: npm run android:install
//
// The three public account build values are resolved by
// scripts/account-config.mjs: from the environment, or with the Volcengine CLI.
//
// Optional settings:
//   OPEN_MUSE_DEVICE  adb serial of the phone when several are connected
//   JAVA_HOME         a JDK 21 or newer (default: the one Gradle finds)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { releaseVersion } from "./build-commit.mjs";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const packageName = "app.openmuse.mobile";

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
  });
}

function pickDevice() {
  let output;
  try {
    output = read("adb", ["devices", "-l"]);
  } catch {
    fail("adb was not found. Install the Android SDK platform tools.");
  }
  const devices = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => ({
      serial: parts[0],
      model: parts.find((part) => part.startsWith("model:"))?.slice(6) ?? "",
    }));
  const wanted = process.env.OPEN_MUSE_DEVICE;
  const matches = wanted
    ? devices.filter((device) => device.serial === wanted)
    : devices;
  const list = devices
    .map((device) => `  ${device.model} ${device.serial}`)
    .join("\n");
  if (matches.length === 0)
    fail(
      wanted
        ? `No connected Android device matches "${wanted}". Connected devices:\n${list || "  (none)"}`
        : "No Android phone found. Connect it with a cable, turn on USB debugging, and allow this computer.",
    );
  if (matches.length > 1)
    fail(
      `Several devices are connected; set OPEN_MUSE_DEVICE to one of:\n${list}`,
    );
  return matches[0];
}

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step("Choosing the device");
const device = pickDevice();
console.log(`device: ${device.model} ${device.serial}`);

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
run(path.join(root, "node_modules/.bin/cap"), ["sync", "android"]);

step("Building the Android app (debug)");
run("./gradlew", ["assembleDebug", "-q"], {
  cwd: path.join(root, "android"),
  env: {
    ...process.env,
    OPEN_MUSE_ANDROID_VERSION_NAME: releaseVersion("HEAD", root),
  },
});
const apk = path.join(
  root,
  "android/app/build/outputs/apk/debug/app-debug.apk",
);

step(`Installing on ${device.model}`);
run("adb", ["-s", device.serial, "install", "-r", apk]);

step("Launching");
run("adb", [
  "-s",
  device.serial,
  "shell",
  "am",
  "start",
  "-S",
  "-n",
  `${packageName}/.MainActivity`,
]);
