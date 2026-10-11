#!/usr/bin/env node
// Lists the redacted problem records the Open Muse service kept for one
// account over the last 14 days: failures the service answered itself, and
// reports the person chose to send from the app. Each holds only request
// labels, statuses, error codes, request IDs, the platform, and versions.
//
// Usage: node server/deploy/volcengine/diagnostics.mjs <email> [limit]
//
// Reads with the Volcengine CLI (`ve login` first), the same way the deploy
// does: the workspace named `open-muse` (or OPEN_MUSE_SUPABASE_WORKSPACE),
// VE_PROFILE to pick a CLI profile. The account ID is derived from the Auth
// user exactly as the service derives it; nothing is written.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [email, limitArg = "50"] = process.argv.slice(2);
if (!email || !/^[^\s'"\\;]{3,254}@[^\s'"\\;]{1,253}$/.test(email)) {
  console.error(
    "usage: node server/deploy/volcengine/diagnostics.mjs <email> [limit]",
  );
  process.exit(1);
}
const limit = Math.min(Math.max(Number(limitArg) || 50, 1), 200);
const name = process.env.OPEN_MUSE_SUPABASE_PROJECT || "open-muse";
const profile = process.env.VE_PROFILE
  ? ["--profile", process.env.VE_PROFILE]
  : [];

function supabase(...args) {
  const output = execFileSync(
    "ve",
    ["byted-supabase-cli", ...args, "-o", "json", ...profile],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 26 },
  );
  return JSON.parse(output.slice(output.search(/[[{]/)));
}

let workspace = process.env.OPEN_MUSE_SUPABASE_WORKSPACE;
if (!workspace) {
  const matches = supabase("projects", "list").projects.filter(
    (entry) => entry.name === name,
  );
  if (matches.length !== 1) {
    console.error(
      `Expected one workspace named "${name}"; set OPEN_MUSE_SUPABASE_WORKSPACE.`,
    );
    process.exit(1);
  }
  workspace = matches[0].reference_id;
}
const domain = supabase("endpoints", "list", "--workspace-id", workspace)
  .Endpoints.flatMap((endpoint) => endpoint.Addresses ?? [])
  .find(
    (address) =>
      address.AddressType === "Public" && address.AddressPort === 443,
  )?.AddressDomain;
if (!domain) {
  console.error(`Workspace ${workspace} has no public HTTPS endpoint.`);
  process.exit(1);
}
const query = (sql) =>
  supabase("db", "query", "--workspace-id", workspace, sql);

const users = query(
  `select id from auth.users where lower(email)=lower('${email}')`,
);
const user = (Array.isArray(users) ? users : (users.rows ?? []))[0]?.id;
if (!user) {
  console.error("No account with that email.");
  process.exit(1);
}
// As shared/supabase-auth.ts derives it from the verified Auth subject.
const owner = `muse_user_${createHash("sha256")
  .update(JSON.stringify([`https://${domain}`, String(user).toLowerCase()]))
  .digest("hex")}`;
const result = query(
  `select kind, created_at, body from open_muse.account_diagnostics where owner_id='${owner}' order by created_at desc limit ${limit}`,
);
const rows = Array.isArray(result) ? result : (result.rows ?? []);
console.log(`account ${owner.slice(0, 22)}…, ${rows.length} record(s)\n`);
for (const row of rows.reverse()) {
  const at = new Date(Number(row.created_at)).toISOString().slice(0, 19) + "Z";
  const body = JSON.parse(row.body);
  if (row.kind === "report") {
    console.log(
      `${at} REPORT ${body.platform} ${body.app_version} | ${body.system || "unknown system"}`,
    );
    for (const failure of body.failures ?? [])
      console.log(
        `    ${new Date(failure.at).toISOString().slice(0, 19)}Z ${failure.via} ${failure.request} ${failure.status ? `HTTP ${failure.status}` : "no answer"}${failure.code ? ` ${failure.code}` : ""}${failure.requestId ? ` request ${failure.requestId}` : ""}${failure.detail ? ` (${failure.detail})` : ""}`,
      );
  } else
    console.log(
      `${at} service ${body.request} HTTP ${body.status}${body.code ? ` ${body.code}` : ""}${body.detail ? ` (${body.detail})` : ""}`,
    );
}
