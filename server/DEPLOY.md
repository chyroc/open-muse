# Deploying the Open Muse service

The service is split across providers by capability. Each capability has one
owner in a deployment; nothing is implemented twice.

| Capability                                  | Volcengine                             | Cloudflare                         |
| ------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Login (Muse accounts)                       | Supabase Auth workspace (email/password) | —                                  |
| Scheduled tasks (the schedule clock)        | veFaaS function with a timer trigger   | Workers Cron (alternative)         |
| Per-account data isolation and the API      | —                                      | Worker                             |
| Encrypted server-side storage               | —                                      | D1, sealed with a Worker secret    |

- **Login.** Apps sign in directly against the Supabase Auth origin. The Worker
  verifies every access token with that origin's `/auth/v1/user` endpoint and
  derives the account owner from the verified user ID only.
- **Scheduled tasks.** A veFaaS timer sends one HMAC-signed request to
  `POST /internal/scheduler/tick` every five minutes. Each tick advances
  persisted background work for at most 20 owners, using each owner's own sealed
  credential. With `SCHEDULER_SOURCE=external` the Worker ignores Workers Cron, so
  only one clock drives the service.
- **Isolation and encryption.** Every row is keyed by the verified owner. Ark API
  keys and workspace bindings are sealed with AES-GCM under the
  `CREDENTIAL_ENCRYPTION_KEYS` keyring, a Worker secret that never enters D1.

Clients still call Ark directly with the account's key. The service never
proxies chat traffic.

## Network reachability

`*.workers.dev` is not reliably reachable from mainland China networks: DNS
answers are often wrong and TLS handshakes are reset. This has two
consequences:

- Run the veFaaS scheduler in a region outside the mainland, such as
  `ap-southeast-1`. A function in `cn-beijing` cannot reach the Worker.
- Devices on such networks cannot reach a `workers.dev` origin either. For them,
  attach a custom domain to the Worker and build the apps with that origin.

The Worker reaches both the Volcengine Supabase origin and the Ark API normally.

## 1. Login: Volcengine Supabase Auth

```sh
# One-time: the workspace needs its service-linked role.
ve iam CreateServiceLinkedRole --ServiceName aidap
ve byted-supabase-cli projects create open-muse --volc-project-name <project> --region cn-beijing
ve byted-supabase-cli endpoints list --workspace-id <workspace>
ve byted-supabase-cli projects api-keys --workspace-id <workspace> --reveal
ve byted-supabase-cli auth config get --workspace-id <workspace>
```

Use the public endpoint's HTTPS origin as the Auth origin and the `AnonKey`
value as the public key. Never configure the service-role key anywhere. Review
the Auth settings (signup, email confirmation, rate limits) with
`auth config get` / `auth config set`.

## 2. Storage and API: Cloudflare Worker and D1

Create a D1 database, then copy `wrangler.jsonc` to the ignored
`wrangler.local.jsonc` with the real `account_id` and `database_id`, and set:

```jsonc
"triggers": { "crons": [] },
"vars": {
  "OWNER_ID": "private-owner",
  "BACKGROUND_ENABLED": "true",
  "SCHEDULER_SOURCE": "external",
  "ALLOWED_ORIGINS": "capacitor://localhost,muse://app",
  "SUPABASE_AUTH_URL": "https://<auth-origin>",
  "SUPABASE_ANON_KEY": "<anon-key>"
}
```

Then, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment:

```sh
cd server
npx wrangler d1 migrations apply DB --remote -c wrangler.local.jsonc
npx wrangler secret put CREDENTIAL_ENCRYPTION_KEYS -c wrangler.local.jsonc
npx wrangler secret put SCHEDULER_TRIGGER_SECRET -c wrangler.local.jsonc
npx wrangler deploy -c wrangler.local.jsonc
```

`CREDENTIAL_ENCRYPTION_KEYS` is `{"current":"v1","keys":{"v1":"<32 random
bytes, base64>"}}`. `SCHEDULER_TRIGGER_SECRET` is at least 43 URL-safe random
characters (for example 48 random bytes in base64url). Keep both outside the
repository; losing the keyring makes stored credentials unreadable.

To use Workers Cron instead of Volcengine, omit `SCHEDULER_SOURCE`, set
`"crons": ["*/5 * * * *"]`, and skip step 3.

## 3. Scheduled tasks: veFaaS timer

```sh
MUSE_API_ORIGIN=https://<worker-origin> \
SCHEDULER_TRIGGER_SECRET=<same secret as the Worker> \
VOLC_PROJECT=<project> VOLC_REGION=ap-southeast-1 \
node server/deploy/volcengine/deploy-scheduler.mjs
```

The script creates or updates the `open-muse-scheduler` function
(`native-node20/v1`), releases it, and enables a `*/5 * * * *` timer. Re-run it
to rotate the secret or change the origin. Each invocation logs only the HTTP
status of its trigger, which you can read with veFaaS
`GetFunctionInstanceLogs`.

## 4. Apps

Build both apps against the deployment from the repository root:

```sh
export VITE_MUSE_BACKGROUND_URL=https://<worker-origin>
export VITE_MUSE_SUPABASE_URL=https://<auth-origin>
export VITE_MUSE_SUPABASE_ANON_KEY=<anon-key>
npm run macos:build
npm run ios:build
```

These three values are public configuration; the apps add exactly these
origins to their connection policy.

## Checking a deployment

- `GET /health` on the Worker returns `{"ok":true}`.
- A signed-in account's `GET /v1/status` returns its `muse_user_*` owner; a
  second account sees none of the first account's credential, connection,
  runs, or Feed.
- After an account saves its key, prepares its workspace, and allows background
  work, `POST /v1/runs` queues a run that later timer ticks move to `complete`.
  Each tick advances one stage, so a run takes several ticks.
