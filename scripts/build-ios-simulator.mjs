// Builds the iPhone app for the Simulator: an Open Muse account build, like
// every app build (see scripts/account-config.mjs for where its three public
// values come from), synced into the Capacitor project and compiled with
// xcodebuild into .build/ios.
//
// Usage: npm run ios:build
import { execFileSync } from "node:child_process";
import path from "node:path";
import { accountBuildEnv, accountConfig } from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });

const env = accountBuildEnv(accountConfig());
run("npm", ["run", "build"], { env });
run("npx", ["cap", "sync", "ios"], { env });
run("xcodebuild", [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  "Debug",
  "-sdk",
  "iphonesimulator",
  "-destination",
  "generic/platform=iOS Simulator",
  "-derivedDataPath",
  ".build/ios",
  "CODE_SIGN_IDENTITY=-",
  "CODE_SIGNING_ALLOWED=YES",
  "build",
  "-quiet",
]);
