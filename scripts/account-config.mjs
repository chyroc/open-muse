// The three public values that make a Muse-account build, shared by the
// iPhone install and the Mac account build.
//
// They come from the environment when all of them are set
// (VITE_MUSE_BACKGROUND_URL, VITE_MUSE_SUPABASE_URL,
// VITE_MUSE_SUPABASE_ANON_KEY). Otherwise they are read with the Volcengine
// CLI (`ve`) from the Supabase workspace OPEN_MUSE_SUPABASE_WORKSPACE, or the
// one named OPEN_MUSE_SUPABASE_PROJECT (default "open-muse"). VE_PROFILE
// selects a `ve` profile. Only the workspace's public anon key is kept; no
// other key is used.
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`\nerror: ${message}`);
  process.exit(1);
}

function read(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ve(...args) {
  const profile = process.env.VE_PROFILE
    ? ["--profile", process.env.VE_PROFILE]
    : [];
  let output;
  try {
    output = read("ve", [
      "byted-supabase-cli",
      ...args,
      ...profile,
      "-o",
      "json",
    ]);
  } catch {
    fail(
      "The Volcengine CLI could not read the Supabase workspace. Run `ve login` (and `ve byted-supabase-cli login` if asked), or set VITE_MUSE_BACKGROUND_URL, VITE_MUSE_SUPABASE_URL, and VITE_MUSE_SUPABASE_ANON_KEY.",
    );
  }
  return JSON.parse(output);
}

export function accountConfig() {
  const {
    VITE_MUSE_BACKGROUND_URL: background,
    VITE_MUSE_SUPABASE_URL: auth,
    VITE_MUSE_SUPABASE_ANON_KEY: anonKey,
  } = process.env;
  if (background && auth && anonKey) return { background, auth, anonKey };

  let workspace = process.env.OPEN_MUSE_SUPABASE_WORKSPACE;
  if (!workspace) {
    const name = process.env.OPEN_MUSE_SUPABASE_PROJECT || "open-muse";
    const matches = ve("projects", "list").projects.filter(
      (project) => project.name === name,
    );
    if (matches.length !== 1)
      fail(
        `Expected one Supabase workspace named "${name}", found ${matches.length}. Set OPEN_MUSE_SUPABASE_WORKSPACE.`,
      );
    workspace = matches[0].reference_id;
  }

  const domain = ve("endpoints", "list", "--workspace-id", workspace)
    .Endpoints.flatMap((endpoint) => endpoint.Addresses ?? [])
    .find(
      (address) =>
        address.AddressType === "Public" && address.AddressPort === 443,
    )?.AddressDomain;
  if (!domain) fail(`Workspace ${workspace} has no public HTTPS endpoint.`);

  const key = ve(
    "projects",
    "api-keys",
    "--workspace-id",
    workspace,
    "--reveal",
  ).find((entry) => entry.name === "AnonKey" && entry.type === "Public");
  if (!key?.api_key) fail(`Workspace ${workspace} has no public anon key.`);

  const origin = `https://${domain}`;
  return {
    background: background || `${origin}/functions/v1/open-muse`,
    auth: auth || origin,
    anonKey: key.api_key,
  };
}

export async function checkService(background) {
  let body;
  try {
    const response = await fetch(`${background}/health`, {
      signal: AbortSignal.timeout(15_000),
    });
    body = await response.json();
  } catch (error) {
    fail(`The Open Muse service at ${background} is unreachable: ${error}`);
  }
  if (body?.ok !== true)
    fail(
      `The Open Muse service at ${background} is not healthy. Deploy it first (server/DEPLOY.md).`,
    );
}

// The environment that makes `npm run build` or `npm run macos:build` produce
// an account build.
export function accountBuildEnv(config) {
  return {
    ...process.env,
    VITE_MUSE_BACKGROUND_URL: config.background,
    VITE_MUSE_SUPABASE_URL: config.auth,
    VITE_MUSE_SUPABASE_ANON_KEY: config.anonKey,
  };
}
