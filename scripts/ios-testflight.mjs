// Archive Open Muse as a Muse-account Release build and upload it to App Store
// Connect for TestFlight.
//
// Usage: npm run ios:testflight [-- <build-number>]
//
// The three public account build values are resolved by
// scripts/account-config.mjs: from the environment, or with the Volcengine CLI.
// The app record must already exist in App Store Connect (the API cannot create
// one). Signing is manual with the team's "Apple Distribution" identity in the
// login keychain and an App Store provisioning profile that this script creates
// or refreshes through the App Store Connect API.
//
// Settings:
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH  App Store Connect API key (default:
//                                            ~/.appstoreconnect/asc_key.json and
//                                            AuthKey_<id>.p8 beside it)
//   DEVELOPMENT_TEAM        signing team (default: the Apple Distribution team)
//   OPEN_MUSE_PROFILE       profile name (default: "Open Muse App Store")
//   default build number:   yyyymmddHHMM
import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountBuildEnv,
  accountConfig,
  checkService,
} from "./account-config.mjs";
import { checkPurposeStrings } from "./check-purpose-strings.mjs";

const root = path.resolve(import.meta.dirname, "..");
const bundleID = "app.openmuse.mobile";
const profileName = process.env.OPEN_MUSE_PROFILE || "Open Muse App Store";
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const buildNumber =
  process.argv[2] ||
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = path.join(root, ".build/ios-release");
const archive = path.join(out, `Open Muse ${buildNumber}.xcarchive`);

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

function apiKey() {
  const dir = path.join(os.homedir(), ".appstoreconnect");
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(path.join(dir, "asc_key.json"), "utf8"));
  } catch {}
  const id = process.env.ASC_KEY_ID || saved.key_id;
  const issuer = process.env.ASC_ISSUER_ID || saved.issuer_id;
  const file = process.env.ASC_KEY_PATH || path.join(dir, `AuthKey_${id}.p8`);
  if (!id || !issuer || !existsSync(file))
    fail(
      "No App Store Connect API key. Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH.",
    );
  return { id, issuer, file };
}

const key = apiKey();

function token() {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "ES256", kid: key.id, typ: "JWT" })}.${encode({ iss: key.issuer, iat, exp: iat + 1200, aud: "appstoreconnect-v1" })}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(readFileSync(key.file)),
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

async function api(method, pathname, body) {
  const response = await fetch(
    `https://api.appstoreconnect.apple.com${pathname}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const text = await response.text();
  if (!response.ok)
    fail(`App Store Connect ${method} ${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function distributionTeam() {
  if (process.env.DEVELOPMENT_TEAM) return process.env.DEVELOPMENT_TEAM;
  const names = [
    ...read("security", ["find-identity", "-v", "-p", "codesigning"]).matchAll(
      /"(Apple Distribution: [^"]+)"/g,
    ),
  ].map((match) => match[1]);
  const teams = new Set(names.map((name) => name.match(/\((\w+)\)$/)?.[1]));
  teams.delete(undefined);
  if (teams.size === 0)
    fail("No Apple Distribution signing identity in the keychain.");
  if (teams.size > 1)
    fail(
      `Several distribution teams are available (${[...teams].join(", ")}); set DEVELOPMENT_TEAM.`,
    );
  return [...teams][0];
}

// A profile goes stale when capabilities or the certificate change, so it is
// recreated on every run; that is cheap and keeps it in sync.
async function refreshProfile() {
  const bundle = (
    await api(
      "GET",
      `/v1/bundleIds?filter[identifier]=${bundleID}&filter[platform]=IOS`,
    )
  ).data.find((item) => item.attributes.identifier === bundleID);
  if (!bundle)
    fail(`The bundle ID ${bundleID} is not registered in this team.`);
  const certificates = (
    await api("GET", "/v1/certificates?limit=200")
  ).data.filter((item) =>
    ["DISTRIBUTION", "IOS_DISTRIBUTION"].includes(
      item.attributes.certificateType,
    ),
  );
  if (certificates.length === 0)
    fail("The team has no distribution certificate.");
  const certificate = certificates.reduce((a, b) =>
    a.attributes.expirationDate > b.attributes.expirationDate ? a : b,
  );
  const existing = await api(
    "GET",
    `/v1/profiles?filter[name]=${encodeURIComponent(profileName)}&limit=200`,
  );
  for (const profile of existing.data)
    await api("DELETE", `/v1/profiles/${profile.id}`);
  const created = (
    await api("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name: profileName, profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: {
            data: [{ type: "certificates", id: certificate.id }],
          },
        },
      },
    })
  ).data;
  const dir = path.join(
    os.homedir(),
    "Library/MobileDevice/Provisioning Profiles",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${created.attributes.uuid}.mobileprovision`),
    Buffer.from(created.attributes.profileContent, "base64"),
  );
}

step("Resolving the Open Muse account service");
const config = accountConfig();
console.log(`service: ${config.background}`);
await checkService(config.background);

step("Preparing distribution signing");
const team = distributionTeam();
await refreshProfile();
console.log(`team:    ${team}`);
console.log(`profile: ${profileName}`);
console.log(`build:   ${buildNumber}`);

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

const auth = [
  "-authenticationKeyPath",
  key.file,
  "-authenticationKeyID",
  key.id,
  "-authenticationKeyIssuerID",
  key.issuer,
];

step("Archiving the iOS app (Release)");
rmSync(archive, { recursive: true, force: true });
run("xcodebuild", [
  "-project",
  "ios/App/App.xcodeproj",
  "-scheme",
  "App",
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "-archivePath",
  archive,
  "-derivedDataPath",
  path.join(out, "DerivedData"),
  `DEVELOPMENT_TEAM=${team}`,
  "CODE_SIGN_STYLE=Manual",
  "CODE_SIGN_IDENTITY=Apple Distribution",
  `PROVISIONING_PROFILE_SPECIFIER=${profileName}`,
  `CURRENT_PROJECT_VERSION=${buildNumber}`,
  "archive",
  "-quiet",
]);

step("Checking the purpose strings");
// App Review rejects a build whose permission prompts show placeholders.
checkPurposeStrings(path.join(archive, "Products/Applications/App.app"));

step("Uploading to App Store Connect");
const temp = mkdtempSync(path.join(os.tmpdir(), "open-muse-export-"));
try {
  const options = path.join(temp, "ExportOptions.plist");
  writeFileSync(
    options,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict><key>${bundleID}</key><string>${profileName}</string></dict>
  <key>teamID</key><string>${team}</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`,
  );
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportOptionsPlist",
    options,
    "-exportPath",
    path.join(temp, "export"),
    ...auth,
  ]);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log(`
Uploaded build ${buildNumber}. It appears in App Store Connect → TestFlight after
processing, usually within 10–30 minutes. Archive: ${archive}`);
