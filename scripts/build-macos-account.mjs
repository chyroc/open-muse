// Build the Mac app as a Muse-account app, so it signs in with an Open Muse
// account (email and password) like the iPhone app instead of running in
// single-user local mode.
//
// Usage: npm run macos:build:account
//
// The account values are resolved as for `npm run ios:install`; see
// scripts/account-config.mjs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";

const root = path.resolve(import.meta.dirname, "..");

console.log("\n==> Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

console.log("\n==> Building the Mac app with Open Muse accounts");
execFileSync("npm", ["run", "macos:build"], {
  cwd: root,
  stdio: "inherit",
  env: accountBuildEnv(config),
});
const page = path.join(
  root,
  ".build/macos/Open Muse.app/Contents/Resources/web/index.html",
);
if (!readFileSync(page, "utf8").includes(new URL(config.auth).origin)) {
  console.error("\nerror: The built app does not include the account service.");
  process.exit(1);
}
console.log(`\nBuilt ${path.dirname(path.dirname(path.dirname(page)))}`);
