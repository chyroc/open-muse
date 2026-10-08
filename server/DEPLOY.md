# Deploying the Open Muse service

The primary deployment runs entirely on Volcengine, in one Supabase workspace
plus a veFaaS timer. The same service code can still be deployed as a
Cloudflare Worker with D1 (see the last section).

| Capability                             | Volcengine                                         |
| -------------------------------------- | -------------------------------------------------- |
| Login (Open Muse accounts)                  | Supabase Auth (email/password)                     |
| API, per-account isolation             | Supabase Edge Function `open-muse` (Deno)          |
| Encrypted server-side storage          | Workspace Postgres, schema `open_muse`             |
| Scheduled tasks (the schedule clock)   | veFaaS function with a timer trigger, `cn-beijing` |

- **Login.** Apps sign in directly against the workspace's Auth origin. The
  function verifies every access token with `/auth/v1/user` and derives the
  account owner from the verified user ID only.
- **API.** The function runs `handle()` from `src/index.ts`. The gateway's JWT
  check is off because the service authenticates every request itself, and the
  scheduler trigger carries no user token. The base URL is
  `https://<auth-origin>/functions/v1/open-muse`.
- **Storage and isolation.** Tables live in the `open_muse` schema, which the
  Supabase data API does not expose; `anon` and `authenticated` have no access.
  The function connects as `open_muse_service`, a role limited to reading and
  writing those tables. Every row is keyed by the verified owner. Ark API keys,
  workspace bindings, and device names are sealed with AES-GCM under the
  `CREDENTIAL_ENCRYPTION_KEYS` keyring, a function secret that never enters the
  database. The service never uses the workspace's service-role key.
- **Scheduled tasks.** A veFaaS timer sends one HMAC-signed request to
  `POST <base>/internal/scheduler/tick` every five minutes. Each tick advances
  persisted background work and due Upcoming reminders, using each owner's own
  sealed credential. The timer also keeps the function warm.

Clients call Ark directly with the account's key; the service never proxies
chat traffic. Everything is reachable from mainland networks.

## 1. Supabase workspace

```sh
ve iam CreateServiceLinkedRole --ServiceName aidap   # once per account
ve byted-supabase-cli projects create open-muse --volc-project-name <project> --region cn-beijing
ve byted-supabase-cli endpoints list --workspace-id <workspace>
ve byted-supabase-cli projects api-keys --workspace-id <workspace> --reveal
ve byted-supabase-cli auth config get --workspace-id <workspace>
```

The public endpoint's HTTPS origin is the Auth origin; the `AnonKey` value is
the public key. Review signup and email-confirmation policy with
`auth config get` / `auth config set`. The Postgres host is the workspace's
compute endpoint (`*.pg*.aidap-global.<region>.volces.com`).

## 2. API and database

```sh
SUPABASE_WORKSPACE=<workspace> \
OPEN_MUSE_DB_HOST=<postgres host> \
OPEN_MUSE_DB_PASSWORD=<random password for open_muse_service> \
OPEN_MUSE_AUTH_URL=https://<auth-origin> \
OPEN_MUSE_ANON_KEY=<anon key> \
CREDENTIAL_ENCRYPTION_KEYS='{"current":"v1","keys":{"v1":"<32 random bytes, base64>"}}' \
SCHEDULER_TRIGGER_SECRET=<43+ URL-safe random characters> \
node server/deploy/volcengine/deploy-function.mjs
```

The script bundles the service with `function/entry.ts`, creates the
`open_muse` schema and role, creates `open_muse.delete_auth_user`, a security
definer function that removes one Auth user by ID and is the role's only
access to the `auth` schema (used by account deletion), applies new files from
`migrations-postgres/`
(recorded in `open_muse.schema_migrations`), sets the function secrets from a
private temporary file, and deploys the function. It is safe to rerun. Keep
the secrets outside the repository; losing the keyring makes stored
credentials unreadable.

To ship new code to an existing deployment, set only `SUPABASE_WORKSPACE`.
The script then checks that the function already has its secrets and the
`open_muse_service` role exists, applies new migrations, and deploys without
changing any secret or the role's password.

The function accepts requests only from the app origins in
`OPEN_MUSE_ALLOWED_ORIGINS` (comma-separated exact origins; default
`capacitor://localhost,https://localhost,muse://app` for the iPhone, Android,
and Mac apps). To let a locally run web app reach the
service, include its origin, then deploy again: a changed secret takes effect
only after the next deployment.

```bash
ve byted-supabase-cli secrets set \
  "OPEN_MUSE_ALLOWED_ORIGINS=capacitor://localhost,https://localhost,muse://app,http://127.0.0.1:4310,http://localhost:4310" \
  --workspace-id <workspace>
SUPABASE_WORKSPACE=<workspace> node server/deploy/volcengine/deploy-function.mjs
```

## 3. Scheduled tasks

```sh
MUSE_API_ORIGIN=https://<auth-origin>/functions/v1/open-muse \
SCHEDULER_TRIGGER_SECRET=<same secret> \
VOLC_PROJECT=<project> VOLC_REGION=cn-beijing \
node server/deploy/volcengine/deploy-scheduler.mjs
```

The script creates or updates the `open-muse-scheduler` function
(`native-node20/v1`), releases it, and enables a `*/5 * * * *` timer. Each
invocation logs only the HTTP status of its trigger (veFaaS
`GetFunctionInstanceLogs`).

## 4. Apps

```sh
export VITE_MUSE_BACKGROUND_URL=https://<auth-origin>/functions/v1/open-muse
export VITE_MUSE_SUPABASE_URL=https://<auth-origin>
export VITE_MUSE_SUPABASE_ANON_KEY=<anon key>
npm run macos:build
npm run ios:build
```

These are public configuration. Requests go to the base URL plus `/v1/…`, and
the apps' connection policy names its origin.

Apps and service use Volcano Ark Managed Agents by default. To build for
Claude Managed Agents instead, add `VITE_MUSE_MA_PROVIDER=claude` to the app
build and set the function secret `OPEN_MUSE_MA_PROVIDER=claude` (or
`MA_PROVIDER` for a Worker); the two must match.

## Checking a deployment

- `GET <base>/health` returns `"ok":true` with `scheduler.lastTickAt` within
  the last few minutes once the timer runs. While the timer has not
  succeeded for 15 minutes it returns 503 with `"ok":false`; point an uptime
  monitor at it. `keyRotation.pending` counts values not yet under the current
  encryption key.
- A signed-in account's `GET <base>/v1/status` returns its `muse_user_*` owner;
  a second account sees none of the first account's credential, connection,
  runs, devices, or Feed.
- `GET <auth-origin>/rest/v1/account_credentials` with the anon key returns 404:
  the service's tables are not reachable through the data API.
- After an account saves its key, prepares its workspace, and allows background
  work, `POST <base>/v1/runs` queues a run that later timer ticks move to
  `complete`.
- Incoming webhooks need nothing extra: the function is deployed with
  `--no-verify-jwt`, so external systems reach `POST <base>/v1/hooks/<id>`
  with only the hook's token, and the apps show `<base>/v1/hooks/<id>`. A
  request with a wrong token returns 401. Keep request-URL logging off at any
  proxy in front of the service, since Lark sends the token as `?token=`.

## Rotating the encryption keyring

The function's secrets cannot be read back, so a new keyring is added next to
the deployed one instead of edited into it.

1. Generate a keyring locally with a key ID the deployed keyring does not use
   (a date keeps it unique), and back it up somewhere private before going
   further. Losing it after the switch makes stored credentials unreadable.

   ```sh
   node -e 'console.log(JSON.stringify({current:"k20261003",keys:{k20261003:require("node:crypto").randomBytes(32).toString("base64")}}))' > next-keyring.json
   chmod 600 next-keyring.json
   ```

2. Set it as `CREDENTIAL_ENCRYPTION_KEYS_NEXT` from a private file, then ship
   the code with the other secrets kept (`SUPABASE_WORKSPACE` only), which also
   restarts the function with the new secret:

   ```sh
   (umask 077; printf "CREDENTIAL_ENCRYPTION_KEYS_NEXT='%s'\n" "$(cat next-keyring.json)" > next.env)
   ve byted-supabase-cli secrets set --env-file next.env --workspace-id <workspace>
   rm next.env
   SUPABASE_WORKSPACE=<workspace> node server/deploy/volcengine/deploy-function.mjs
   ```

   New values are now sealed with the new key and older rows still open.
   Until step 4, ship code only in this keep-secrets mode. If
   the new keyring is malformed or reuses a key ID with other material,
   credential storage stops working (status reports
   `credentialStorageReady: false`); unset the secret and start over.

3. Wait until `GET <base>/health` reports `keyRotation.pending` as `0`. Each
   timer tick reseals up to 50 rows per sealed column. A count that stops
   falling means rows the keyring cannot open; do not continue.

4. Make the new keyring the only one: set `CREDENTIAL_ENCRYPTION_KEYS` to it
   the same way (an env file containing `CREDENTIAL_ENCRYPTION_KEYS='…'`),
   then remove the rotation secret and ship again:

   ```sh
   ve byted-supabase-cli secrets unset CREDENTIAL_ENCRYPTION_KEYS_NEXT --workspace-id <workspace>
   SUPABASE_WORKSPACE=<workspace> node server/deploy/volcengine/deploy-function.mjs
   ```

   Pass the new keyring from now on when running a full deployment. Keep the old
   keyring's backup until database backups holding older ciphertext expire.

On a Worker, use `wrangler secret put CREDENTIAL_ENCRYPTION_KEYS_NEXT`, then
`wrangler secret put CREDENTIAL_ENCRYPTION_KEYS` and
`wrangler secret delete CREDENTIAL_ENCRYPTION_KEYS_NEXT` in the same order.

## Alternative: Cloudflare Worker and D1

The service also runs as a Worker with D1 (`wrangler.jsonc`, `migrations/`).
Keep `migrations/` (SQLite) and `migrations-postgres/` in step, and write SQL
that runs on both; `npm run check` runs every test on both databases. For a
Worker deployment, set the same secrets with `wrangler secret put` and the
public `SUPABASE_AUTH_URL` and `SUPABASE_ANON_KEY` as variables (without them
every authenticated request returns 503), apply D1
migrations with `wrangler d1 migrations apply DB --remote`, and either use
Workers Cron (omit `SCHEDULER_SOURCE`) or point the veFaaS timer at the Worker.
`*.workers.dev` is not reliably reachable from mainland networks, so a Worker
for mainland users needs a custom domain.
