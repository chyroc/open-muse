#!/usr/bin/env node
// Deploys the Open Muse service to Volcengine in one command, or updates an
// existing deployment: the Supabase workspace, the API function with its
// database and secrets, and the scheduler. It wraps deploy-function.mjs and
// deploy-scheduler.mjs, and prints the three public values that make an app
// build.
//
//   npm run server:deploy                # create or update
//   npm run server:deploy -- --dry-run   # only read and report the plan
//
// Settings (all optional except OPEN_MUSE_DB_HOST on a first deployment):
//   OPEN_MUSE_SUPABASE_WORKSPACE  workspace ID; default: the workspace named
//                                 OPEN_MUSE_SUPABASE_PROJECT ("open-muse"),
//                                 created when there is none
//   VOLC_PROJECT, VOLC_REGION     Volcengine project ("default") and region
//                                 ("cn-beijing") of a new workspace
//   OPEN_MUSE_DB_HOST             the workspace's Postgres host, from its
//                                 connection details in the console; needed
//                                 only when the function has no secrets yet
//   OPEN_MUSE_ALLOWED_ORIGINS     app origins to accept, set as a secret first
//   OPEN_MUSE_DEPLOY_SECRETS      where generated secrets are kept (default
//                                 ~/.open-muse/deploy/<workspace>.json, 0600)
//   VE_PROFILE                    `ve` profile
//
// Requires `ve` signed in (`ve login`) and the `zip` command. Secrets are
// generated once, kept only in the private file above and in the function, and
// never printed. Back up the file: losing its keyring makes stored
// credentials unreadable.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const name = process.env.OPEN_MUSE_SUPABASE_PROJECT || "open-muse";
const project = process.env.VOLC_PROJECT || "default";
const region = process.env.VOLC_REGION || "cn-beijing";
const profile = process.env.VE_PROFILE
  ? ["--profile", process.env.VE_PROFILE]
  : [];
// The secrets a deployed function must hold (see deploy-function.mjs).
const SERVICE_SECRETS = [
  "OPEN_MUSE_DATABASE_URL",
  "OPEN_MUSE_AUTH_URL",
  "OPEN_MUSE_ANON_KEY",
  "CREDENTIAL_ENCRYPTION_KEYS",
  "SCHEDULER_TRIGGER_SECRET",
];

function step(message) {
  console.log(`\n==> ${message}`);
}
function fail(message) {
  console.error(`\nerror: ${message}`);
  process.exit(1);
}
function ve(args, { json = true, input } = {}) {
  const output = execFileSync("ve", [...args, ...profile], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return json ? JSON.parse(output.slice(output.search(/[[{]/))) : output;
}
const supabase = (...args) => ve(["byted-supabase-cli", ...args, "-o", "json"]);
function run(script, env) {
  execFileSync(process.execPath, [join(here, script)], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

step("Checking the Volcengine CLI");
let projects;
try {
  projects = supabase("projects", "list").projects;
} catch {
  fail(
    "The Volcengine CLI is not signed in. Run `ve login` (and `ve byted-supabase-cli login` if asked).",
  );
}

step("Finding the Supabase workspace");
let workspace = process.env.OPEN_MUSE_SUPABASE_WORKSPACE;
if (!workspace) {
  const matches = projects.filter((entry) => entry.name === name);
  if (matches.length > 1)
    fail(
      `Several workspaces are named "${name}"; set OPEN_MUSE_SUPABASE_WORKSPACE.`,
    );
  workspace = matches[0]?.reference_id;
}
if (!workspace) {
  console.log(`No workspace named "${name}": one will be created.`);
  if (dryRun) {
    console.log(
      `Would create workspace "${name}" in project "${project}", ${region}, then deploy the API and scheduler. A first deployment also needs OPEN_MUSE_DB_HOST.`,
    );
    process.exit(0);
  }
  try {
    // The workspace service needs its service-linked role, once per account.
    ve(["iam", "CreateServiceLinkedRole", "--ServiceName", "aidap"], {
      json: false,
    });
  } catch {
    // It already exists.
  }
  ve(
    [
      "byted-supabase-cli",
      "projects",
      "create",
      name,
      "--volc-project-name",
      project,
      "--region",
      region,
      "--yes",
    ],
    { json: false },
  );
  for (let i = 0; i < 60 && !workspace; i++) {
    await sleep(10_000);
    const created = supabase("projects", "list").projects.find(
      (entry) => entry.name === name && entry.status === "Running",
    );
    workspace = created?.reference_id;
  }
  if (!workspace)
    fail(`Workspace "${name}" was created but is not running yet; run again.`);
}
console.log(`workspace: ${workspace}`);

const domain = supabase("endpoints", "list", "--workspace-id", workspace)
  .Endpoints.flatMap((endpoint) => endpoint.Addresses ?? [])
  .find(
    (address) =>
      address.AddressType === "Public" && address.AddressPort === 443,
  )?.AddressDomain;
if (!domain) fail(`Workspace ${workspace} has no public HTTPS endpoint.`);
const anonKey = supabase(
  "projects",
  "api-keys",
  "--workspace-id",
  workspace,
  "--reveal",
).find((entry) => entry.name === "AnonKey" && entry.type === "Public")?.api_key;
if (!anonKey) fail(`Workspace ${workspace} has no public anon key.`);
const origin = `https://${domain}`;
const base = `${origin}/functions/v1/open-muse`;

step("Reading the function's secrets");
const listed = ve(
  ["byted-supabase-cli", "secrets", "list", "--workspace-id", workspace],
  { json: false },
);
const has = (secret) => new RegExp(`^\\s*${secret}\\s*\\|`, "m").test(listed);
const deployed = SERVICE_SECRETS.every(has);
const file =
  process.env.OPEN_MUSE_DEPLOY_SECRETS ||
  join(homedir(), ".open-muse", "deploy", `${workspace}.json`);
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
console.log(
  deployed
    ? "The function has its secrets: this updates the code and keeps them."
    : "The function has no secrets yet: this is a first deployment.",
);

if (dryRun) {
  console.log(`
Plan (nothing was changed):
  ${process.env.OPEN_MUSE_ALLOWED_ORIGINS ? "set OPEN_MUSE_ALLOWED_ORIGINS, then " : ""}deploy the API function ${deployed ? "with its current secrets" : "with new secrets"}
  ${saved.schedulerSecret || !deployed ? "deploy the scheduler" : "keep the scheduler (its trigger secret is not in " + file + ")"}
  check ${base}/health`);
  process.exit(0);
}

if (process.env.OPEN_MUSE_ALLOWED_ORIGINS) {
  step("Setting the accepted app origins");
  ve(
    [
      "byted-supabase-cli",
      "secrets",
      "set",
      `OPEN_MUSE_ALLOWED_ORIGINS=${process.env.OPEN_MUSE_ALLOWED_ORIGINS}`,
      "--workspace-id",
      workspace,
    ],
    { json: false },
  );
}

let schedulerSecret = saved.schedulerSecret;
if (!deployed) {
  const host = process.env.OPEN_MUSE_DB_HOST || saved.dbHost;
  if (!host)
    fail(
      "A first deployment needs the workspace's Postgres host: set OPEN_MUSE_DB_HOST from the workspace's connection details in the Volcengine console.",
    );
  // Generated once and kept before use, so a failed run reuses them.
  const secrets = {
    dbHost: host,
    dbPassword: saved.dbPassword || randomBytes(24).toString("base64url"),
    keyring:
      saved.keyring ||
      JSON.stringify({
        current: "v1",
        keys: { v1: randomBytes(32).toString("base64") },
      }),
    schedulerSecret:
      saved.schedulerSecret || randomBytes(32).toString("base64url"),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Secrets kept in ${file}. Back this file up somewhere private.`);
  schedulerSecret = secrets.schedulerSecret;
  step("Deploying the API function with new secrets");
  run("deploy-function.mjs", {
    SUPABASE_WORKSPACE: workspace,
    OPEN_MUSE_DB_HOST: secrets.dbHost,
    OPEN_MUSE_DB_PASSWORD: secrets.dbPassword,
    OPEN_MUSE_AUTH_URL: origin,
    OPEN_MUSE_ANON_KEY: anonKey,
    CREDENTIAL_ENCRYPTION_KEYS: secrets.keyring,
    SCHEDULER_TRIGGER_SECRET: secrets.schedulerSecret,
  });
} else {
  step("Deploying the API function");
  // Keep-secrets mode: only the workspace is passed.
  const env = { SUPABASE_WORKSPACE: workspace };
  for (const secret of [
    "OPEN_MUSE_DB_HOST",
    "OPEN_MUSE_DB_PASSWORD",
    "OPEN_MUSE_AUTH_URL",
    "OPEN_MUSE_ANON_KEY",
    "CREDENTIAL_ENCRYPTION_KEYS",
    "SCHEDULER_TRIGGER_SECRET",
  ])
    env[secret] = "";
  run("deploy-function.mjs", env);
}

if (schedulerSecret) {
  step("Deploying the scheduler");
  run("deploy-scheduler.mjs", {
    MUSE_API_ORIGIN: base,
    SCHEDULER_TRIGGER_SECRET: schedulerSecret,
    VOLC_PROJECT: project,
    VOLC_REGION: region,
  });
} else
  console.log(
    `\nKept the scheduler as it is: its trigger secret is not in ${file}.`,
  );

step("Checking the service");
let health;
for (let i = 0; i < 12; i++) {
  try {
    health = await (
      await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) })
    ).json();
    if (health?.ok) break;
  } catch {}
  await sleep(10_000);
}
console.log(
  health?.ok
    ? "The service is healthy."
    : "The service did not report healthy yet. Once the scheduler has run (every five minutes), check again with GET /health.",
);

console.log(`
Build the apps against this deployment with:

  export VITE_MUSE_BACKGROUND_URL=${base}
  export VITE_MUSE_SUPABASE_URL=${origin}
  export VITE_MUSE_SUPABASE_ANON_KEY=${anonKey}
  npm run ios:install   # or npm run macos:build, npm run android:install
`);
