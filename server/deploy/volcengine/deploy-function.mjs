#!/usr/bin/env node
// Deploys the Open Muse API as a Volcengine Supabase Edge Function:
//   1. bundles deploy/volcengine/function/entry.ts with the service code,
//   2. prepares the open_muse schema, its dedicated role, and migrations,
//      and the private storage bucket for attached images,
//   3. sets the function's secrets from a private temporary .env file,
//   4. deploys the function with gateway JWT checks off (the service
//      verifies every request itself).
//
//   SUPABASE_WORKSPACE=<workspace-id> OPEN_MUSE_DB_HOST=<postgres host> \
//   OPEN_MUSE_DB_PASSWORD=... OPEN_MUSE_AUTH_URL=https://<auth-origin> \
//   OPEN_MUSE_ANON_KEY=... CREDENTIAL_ENCRYPTION_KEYS='{"current":...}' \
//   SCHEDULER_TRIGGER_SECRET=... node server/deploy/volcengine/deploy-function.mjs
//
// To update the code of an existing deployment, set only SUPABASE_WORKSPACE:
// the function keeps its current secrets and the service role its password.
//
// Requires `ve` signed in. Secrets are never printed or passed as arguments.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "../..");
const out = join(server, ".build/volcengine");
const NAME = process.env.OPEN_MUSE_FUNCTION || "open-muse";
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
};
const workspace = env("SUPABASE_WORKSPACE");
const SECRET_INPUTS = [
  "OPEN_MUSE_DB_HOST",
  "OPEN_MUSE_DB_PASSWORD",
  "OPEN_MUSE_AUTH_URL",
  "OPEN_MUSE_ANON_KEY",
  "CREDENTIAL_ENCRYPTION_KEYS",
  "SCHEDULER_TRIGGER_SECRET",
];
const keepSecrets = SECRET_INPUTS.every((name) => !process.env[name]);
const secrets = keepSecrets ? undefined : {
  OPEN_MUSE_DATABASE_URL: `postgresql://open_muse_service:${encodeURIComponent(env("OPEN_MUSE_DB_PASSWORD"))}@${env("OPEN_MUSE_DB_HOST")}:5432/postgres?sslmode=require`,
  OPEN_MUSE_AUTH_URL: new URL(env("OPEN_MUSE_AUTH_URL")).origin,
  OPEN_MUSE_ANON_KEY: env("OPEN_MUSE_ANON_KEY"),
  CREDENTIAL_ENCRYPTION_KEYS: env("CREDENTIAL_ENCRYPTION_KEYS"),
  SCHEDULER_TRIGGER_SECRET: env("SCHEDULER_TRIGGER_SECRET"),
};
const SERVICE_SECRETS = [
  "OPEN_MUSE_DATABASE_URL",
  "OPEN_MUSE_AUTH_URL",
  "OPEN_MUSE_ANON_KEY",
  "CREDENTIAL_ENCRYPTION_KEYS",
  "SCHEDULER_TRIGGER_SECRET",
];

const cli = (args, input) =>
  execFileSync("ve", ["byted-supabase-cli", ...args, "--workspace-id", workspace], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
const sql = (text) => {
  const file = join(out, "query.sql");
  writeFileSync(file, text, { mode: 0o600 });
  try {
    const output = cli(["db", "query", "-f", file, "-o", "json"]);
    return JSON.parse(output.slice(output.indexOf("{"))).rows ?? [];
  } finally {
    rmSync(file, { force: true });
  }
};

// Keeping secrets is only for a deployment that already has all of them.
if (keepSecrets) {
  const listed = cli(["secrets", "list"]);
  const missing = SERVICE_SECRETS.filter(
    (name) => !new RegExp(`^\\s*${name}\\s*\\|`, "m").test(listed),
  );
  if (missing.length)
    throw new Error(
      `The function has no ${missing.join(", ")}; set ${SECRET_INPUTS.join(", ")} for a first deployment.`,
    );
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "supabase/functions", NAME), { recursive: true });

// 1. Bundle.
await build({
  entryPoints: [join(here, "function/entry.ts")],
  outfile: join(out, "supabase/functions", NAME, "index.ts"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  external: ["jsr:*"],
  legalComments: "none",
  logLevel: "warning",
});
console.log("Bundled the service.");

// 2. Schema, role, and migrations. Tables live outside `public`, which the
// Supabase data API exposes; only the service role may use them.
const password = secrets?.OPEN_MUSE_DATABASE_URL.match(/:([^:@]+)@/)[1];
if (
  keepSecrets &&
  !sql("SELECT 1 FROM pg_roles WHERE rolname = 'open_muse_service'").length
)
  throw new Error("The open_muse_service role does not exist yet.");
sql(`
CREATE SCHEMA IF NOT EXISTS open_muse;
REVOKE ALL ON SCHEMA open_muse FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA open_muse FROM anon, authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_muse_service') THEN
    CREATE ROLE open_muse_service LOGIN;
  END IF;
END $$;
${
  password
    ? `ALTER ROLE open_muse_service WITH LOGIN PASSWORD '${decodeURIComponent(password).replaceAll("'", "''")}';`
    : ""
}
ALTER ROLE open_muse_service SET search_path = open_muse;
GRANT USAGE ON SCHEMA open_muse TO open_muse_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA open_muse GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO open_muse_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA open_muse GRANT USAGE, SELECT ON SEQUENCES TO open_muse_service;
-- Account deletion: the service may remove one Auth user by its verified ID
-- without holding a service-role key or any other access to the auth schema.
CREATE OR REPLACE FUNCTION open_muse.delete_auth_user(target uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
  AS 'DELETE FROM auth.users WHERE id = target';
REVOKE ALL ON FUNCTION open_muse.delete_auth_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_muse.delete_auth_user(uuid) TO open_muse_service;
-- Copies of the images people attach, so each of their devices can show
-- them: a private bucket where a signed-in account reaches only the folder
-- named by its own user ID. Clients use their own sessions; the service never
-- touches it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS open_muse_attachments_own ON storage.objects;
CREATE POLICY open_muse_attachments_own ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND coalesce((SELECT auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
  WITH CHECK (bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND coalesce((SELECT auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
CREATE TABLE IF NOT EXISTS open_muse.schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
const applied = new Set(
  sql("SELECT name FROM open_muse.schema_migrations").map((row) => row.name),
);
const migrations = join(server, "migrations-postgres");
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  sql(`BEGIN;
SET LOCAL search_path TO open_muse;
${readFileSync(join(migrations, file), "utf8")}
INSERT INTO open_muse.schema_migrations(name) VALUES ('${file}');
COMMIT;`);
  console.log(`Applied ${file}.`);
}
sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA open_muse TO open_muse_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA open_muse TO open_muse_service;
REVOKE ALL ON open_muse.schema_migrations FROM open_muse_service;`);
console.log("Database is ready.");

// 3. Secrets, from a private file that is removed right away.
if (secrets) {
  const dotenv = join(out, "secrets.env");
  writeFileSync(
    dotenv,
    Object.entries(secrets)
      .map(([key, value]) => `${key}='${value.replaceAll("'", "")}'`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  chmodSync(dotenv, 0o600);
  try {
    cli(["secrets", "set", "--env-file", dotenv]);
  } finally {
    rmSync(dotenv, { force: true });
  }
  console.log("Secrets are set.");
} else console.log("Kept the function's current secrets.");

// 4. Deploy.
cli(["functions", "deploy", NAME, "--no-verify-jwt", "--workdir", out, "--yes"]);
console.log(`Deployed function ${NAME}.`);
