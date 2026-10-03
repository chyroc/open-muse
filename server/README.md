# Open Muse service

API service for the iOS and macOS apps. It verifies Open Muse account sessions,
keeps each account's Ark API key encrypted, records account workspace
ownership, and runs background Feed work and Upcoming reminders. It is deployed
on Volcengine as a Supabase Edge Function with the workspace's Postgres, Auth,
and a veFaaS timer; the same code also runs as a Cloudflare Worker with D1. See
[Deploying](DEPLOY.md). No website, static assets, chat proxy, or native app
binaries are hosted here. Clients call Ark directly with the account's key.

## Current scope

The service supports explicit one-off Feed generation, a daily local-time
schedule, durable MA submission/reconciliation, and cursor-based Feed retrieval.
Background generation is disabled by default. Both native apps include the
controls in Settings, under **While you're away**. Background results currently
appear in that card, not in the main Feed tab. Push notifications are not
implemented.

A clock ticks every five minutes: a signed external trigger from a Volcengine
veFaaS timer when `SCHEDULER_SOURCE=external`, or Workers Cron on Cloudflare. Each tick
advances a persisted stage instead of waiting for the agent. Generation and delivery are not exact-time guarantees.
Missed schedule occurrences do not create a catch-up burst. Nonexistent daylight
saving times are skipped. Only one unresolved run is allowed per owner, with at
most three new runs per rolling 24 hours, including manual requests. After an
hour of monitoring, a run requires explicit review; this does not stop MA or
guarantee a model-spend cap. Pausing a schedule stops future automatic dispatch,
not already queued or running work.

Every endpoint except `/health` and the signed scheduler trigger requires an
Open Muse account session (see below). The service derives ownership only from
the verified session, never from a submitted name, query string, or resource ID.

### Upcoming reminders

Reminders and recurring tasks live in `UPCOMING.md` in the account's memory
store. Once an account registers its main conversation, each tick reads that
document with the account's key and computes due occurrences with
`shared/upcoming.ts` (no catch-up burst; at most five items per message). It
sends nothing while the conversation is running or waiting for an approval or
a client's tool result, and skips occurrences already named in its recent
history. Each occurrence is claimed in the database together with one persisted event ID
before a single `user.message` is posted, and is never claimed again. A
definite rejection consumes the occurrence; an ambiguous result is looked up in
history and never resent, and no new reminder is sent while one is
unconfirmed. At most one message per account per tick and 48 per day. The agent
handles the reminder with its normal tools in the main chat; any step that needs
approval waits for the user in the app.

### Live cloud browser

The phone cannot reach a browser running in the account's MA sandbox, so the
service relays a live view of one. Opening a view (`POST /v1/browser/views`)
returns a random token once; the app sends it in a hidden message asking the
conversation's agent to download the helper from `GET /v1/browser/helper` and
start it in the background with the toolbox's Python. The helper runs its own
headless Chrome and, in one request per cycle to
`POST /v1/browser/relay/<view>`, posts the viewport when it changed and takes
the person's pending input. The app polls
`GET /v1/browser/views/<view>/frame` and sends taps, scrolls, typing, Back and
addresses to `POST /v1/browser/views/<view>/input`; `DELETE` ends the view and
the helper with it.

Each account has at most one view, which expires after 30 minutes. The relay
route accepts no browser origin and only the view's token, stored as a hash;
the other routes require the account session. Frames and input are sealed
with the account, input is deleted once the helper has taken it, and both
are removed with the account. The token appears in that conversation's MA
history and stops working when the view ends or expires.

## Open Muse accounts

The API accepts end-user access tokens from one explicitly configured
Supabase Auth provider, including the Volcano-hosted Supabase service. Configure
`SUPABASE_AUTH_URL` as its public HTTPS origin and `SUPABASE_ANON_KEY` as its anon
or publishable key. Never configure a service-role key. The service verifies each
request with the provider's read-only `/auth/v1/user` endpoint. Invalid sessions
are rejected; provider failures return 503 without falling back to another
identity. No token claims, client metadata, names, or emails select the owner.
The stable Muse owner is derived from the configured issuer and verified user
UUID, so different devices retain one identity and different accounts remain
separate even if they share an Ark key.

An account uses only the Ark key it stored through
`/v1/account/credential`; there is no service-level Ark configuration to
inherit. The status response reports
`account: {provider, credential: {configured, revision, updatedAt}}`. To allow
background work, an account sends only its workspace resource IDs to
`PUT /v1/connection` as `{workspace, credentialRevision, revision, confirm}`.
The service pairs them with the account's stored key, verifies them read-only,
and seals the result. A binding prepared for an older key revision returns 409.
Schedules and runs then use that binding, and the scheduler resolves each
account's own sealed binding.

### Account workspaces

Read access proves nothing when accounts share a key, so the service, not the
client, creates each account's agent, environment, and memory store with the
account's stored key (`POST /v1/account/workspace`). It records every resource
in `account_resources` for that account from its own creation response, in the
same database transaction that updates the account's sealed workspace record. Nothing is
ever recorded from a label, a list, or client input, so relabelling a resource
outside Open Muse or racing its creation cannot make it another account's.
Clients never discover or adopt account resources by label.

Creation is sent once. Before each POST the service stores a pending marker with
a random nonce. If the result is unconfirmed, the next request lists the
collection for that nonce: if nothing was created it creates the resource once;
if something was created it is never adopted, because its creation cannot be
attributed with certainty, and the request returns 409 until the user explicitly
continues setup (`replaceUnconfirmed: true`), which creates a new resource and
leaves the unconfirmed one unused. A recorded resource deleted at Ark is created
again; one whose label was changed outside Open Muse stops setup with 409. Each
account may create at most 20 resources per hour.

Resources still carry `metadata.open_muse_workspace` (agent, environment) or
`metadata.open_muse_identity` (memory store) equal to
`accountWorkspaceKey(apiKey, project, owner)` from `shared/workspace-key.ts`,
which clients use to scope local records and check what they read. A binding
(`PUT /v1/connection`) is accepted only for three resources recorded for the
requesting account; this is checked before the service reads any resource, so it
never reads another account's resource on a request's behalf. A holder of the
same Ark key can still read and change every resource directly at Ark: this is
an application boundary, not an Ark authorization boundary. Use separate Ark
keys when accounts must not reach each other's data.

The scheduler only selects account owners whose key was stored under the
currently configured issuer and that made a verified request within the last 30
days. Changing `SUPABASE_AUTH_URL` therefore stops existing account schedules,
and a deleted or suspended provider account stops receiving background work
after at most 30 days without any action. Each account can submit at most 10 new
keys for Ark validation per hour; provider signup policy bounds the number of
accounts.

Only one configured issuer is accepted, and it is the only way to sign in:
without `SUPABASE_AUTH_URL` every authenticated endpoint returns 503. Public signup
policy, provider rate limiting, email verification, SMTP, and abuse protection
are configured at Supabase. The service never needs an Auth administrative key,
password, provider refresh token, or database connection string. CORS and
native connectivity require live acceptance.

### Native email login

Configure the app build with `VITE_MUSE_BACKGROUND_URL`,
`VITE_MUSE_SUPABASE_URL`, and `VITE_MUSE_SUPABASE_ANON_KEY`. These are a public
API origin, a public Auth origin, and an anon/publishable key; service-role JWTs
and secret keys are rejected. The exact Auth origin is added to both Apple
clients' connection policies. Do not put credentials in URLs or tracked files.
Builds without Auth configuration run in single-user local mode, make no
Supabase requests, and do not use this service.

The **Open Muse account** settings card supports email/password signup and login.
Signup requires explicit confirmation and does not count as a confirmed login;
follow the provider's email-verification policy, then sign in. Passwords are
sent directly to Auth and never saved. Only after the service confirms the same
user is the access/refresh session stored in the separate background Keychain
entry (sessionStorage on web, not supported on Android). No account token or
password goes into IndexedDB, a URL, logs, or the service's database.

The client renews the session shortly before the access token expires, at the
start of an operation, and also on explicit request. Before the one refresh POST
it saves a pending marker; an ambiguous outcome requires signing out and in
again, never replaying the potentially rotated refresh token. A successful
same-user refresh is saved immediately, before the service check. Web Locks
coordinate renewal across windows and a saved-session comparison rejects stale
windows. Devices without Web Locks must sign in again instead. Signing out sends
one `POST /auth/v1/logout?scope=local` and always removes the local session;
other devices stay signed in.

A forgotten password is reset in the app with a one-time code: `POST
/auth/v1/recover` emails it, `POST /auth/v1/verify` (`type: "recovery"`) trades
it for a short recovery session, `PUT /auth/v1/user` sets the new password with
that session, which is then signed out; the person signs in as usual. The
provider must have outgoing email (SMTP) configured, and its recovery template
must include the code (`{{ .Token }}`). OAuth callbacks are not implemented.

Deleting the account (`DELETE /v1/account`) removes everything the service
keeps for it and then the sign-in itself; Ark resources stay in the person's
Ark account.

After sign-in the client reads the account's Ark key with
`GET /v1/account/credential` and keeps it in memory. It prepares the workspace
with `POST /v1/account/workspace` and reads its memory store from
`GET /v1/account/workspace`; it never creates or discovers account resources
itself. Saving, replacing, or removing the key goes through the credential
endpoint. Allowing background work sends only the workspace resource IDs. The
app re-reads the key when it returns to the foreground (and when the Mac main
window is focused) to pick up changes from other devices.

A running account build checks its session and key revision with the service
before Ark requests: at most 60 seconds after the last successful check for
reads and 10 seconds for writes, and every 30 seconds regardless of requests.
A change this device already knows (signed out, session rejected here, renewal
unconfirmed) stops Ark requests immediately. A change known only to the service
or the Auth provider (session revoked elsewhere, key removed or replaced on
another device) therefore takes effect on a running device within about 30
seconds, or 10 seconds for writes; it is not instant. If the service cannot be
reached, the next check fails closed: open streams and the runtime stop, and no
Ark request is sent until a check succeeds. These bounds were verified against
protocol doubles of the Auth provider, not a live Supabase project.

Signup failures use one generic message and do not surface provider status
codes, so the form does not reveal whether an email is registered. Live use
requires an authorized Supabase workspace, the correct public endpoint and key,
provider signup/email policy, and native-to-Auth plus service-to-Auth
connectivity. Local builds do not change any cloud settings.

## Local development

Install root dependencies first, then run from this directory:

```sh
npm ci
npm run db:local
npm run check
npm run build
npm run dev
```

`build` bundles the service with Wrangler's dry-run mode. It does not deploy or
create cloud resources. `check` runs the tests twice, on a local Miniflare D1
database and on PGlite (Postgres) with `migrations-postgres/`, with
mocked upstream calls. Development listens on port 4311.

Configure local bindings in ignored `.dev.vars`:

- `SUPABASE_AUTH_URL` and `SUPABASE_ANON_KEY`: the public Auth origin and its
  anon or publishable key. Without them every authenticated endpoint returns
  503.
- `CREDENTIAL_ENCRYPTION_KEYS`: the keyring described under Background
  authorization. Without it account keys cannot be stored.
- `ALLOWED_ORIGINS`: comma-separated exact origins for the native WebViews,
  typically `capacitor://localhost,muse://app`. Verify the actual app origins.
  Requests with no Origin still require authentication. Opaque `null` origins
  and non-allowlisted origins are rejected.

Never put keys or tokens in tracked config, URLs, screenshots, logs, or build
variables.

## Native app connection

After deploying the API, set `VITE_MUSE_BACKGROUND_URL` together with the Auth
variables from Native email login in the build process environment for each
app. It is a public HTTPS origin, not a secret;
paths, credentials, query strings, and fragments are rejected. For example:

```sh
VITE_MUSE_BACKGROUND_URL=https://background.example.com npm run macos:build
VITE_MUSE_BACKGROUND_URL=https://background.example.com npm run ios:build
```

Run these commands from the repository root. Only this exact API origin is
added to the app's connection policy. Builds without the variable have no
background connection and make no requests to this service. Existing Ark
requests still go directly to the existing allowlisted Volcano endpoints.

Each app signs in with an Open Muse account. Signing in alone does not allow
background work. Signing out locally does not pause the server schedule; pause
it explicitly first if future automatic runs should stop.

The settings card supports revision-checked schedule changes with explicit
consent, one-off generation, reviewed reconciliation, and recent runs. A pending
one-off operation ID is saved in Keychain before submission and reused after a
lost response or app restart; writes are not retried automatically. Refreshing
does not discard unsaved schedule edits. Feed content is cached in owner- and
origin-scoped IndexedDB for offline reading, without account tokens. Cached posts
remain on the device after disconnecting. Foreground and network-recovery events
refresh results; native background timers are not needed.

Allowing background work is an explicit action in the settings card. It sends
only the account workspace's resource IDs; the service pairs them with the key
the account stored. It is not automatic on startup, refresh, login, or account
switching. A replacement binding pauses the schedule; explicitly review and
enable it again. Signing out locally does not remove the binding. Removing it
(`DELETE /v1/connection`) revokes the server copy and pauses the schedule.

This integration targets iOS and macOS. It has local client, UI, and build
verification, but requires live origin/CORS, Keychain, and MA acceptance before
use. In particular, a passing build does not prove that a configured service is
deployed or that a real unattended generation can complete.

## API

- `GET /health`: public liveness only; no configuration or credentials.
- `GET /v1/status`: requires `Authorization: Bearer <account access token>`;
  checks the database.
- `PUT /v1/schedule`: `{enabled, timezone, local_time, revision, confirm}`;
  enabling requires `confirm: true`. Stale revisions return 409.
- `POST /v1/runs`: `{confirm: true}` and a stable `Idempotency-Key` of 16–80
  letters, numbers, underscores, or hyphens; returns 202 with the persisted run.
  Repeating this app-level request with the same key returns the same run, not
  another MA request. A new key cannot bypass the unresolved-run or daily limit.
- `GET /v1/runs`: recent runs, without persisted prompts or credentials.
- `GET /v1/feed?after=0`: `{items, cursor, hasMore}`; retain the returned cursor
  for incremental reads. Each item keeps its original MA session/event reference.
- `POST /v1/runs/:id/recheck`: `{confirm: true}`; resumes a reviewed run from
  its persisted phase. An uncertain creation/message is only queried, not resent.
- `GET /v1/account/credential`: Open Muse account sessions only. Returns
  `{configured, revision, updatedAt, credential?}` where `credential` is the
  account's own `{apiKey, project}`.
- `PUT /v1/account/credential`: `{credential, revision, confirm: true}`. The key
  is checked with one read-only Ark request (`GET /agents?limit=1`) and then
  sealed for this account. A stale revision from another device returns 409.
- `DELETE /v1/account/credential`: `{revision, confirm: true}` leaves a
  tombstone for this account only.
- `DELETE /v1/account`: `{confirm: true}` deletes the signed-in account: every
  row the service keeps for it (credential, workspace records, devices,
  background connection, schedule, runs, Feed, reminder delivery), then its
  sign-in at the Auth provider. Data goes first, so a failure at the provider
  leaves a sign-in that can repeat the request. Returns `{deleted: true}`, or
  503 before deleting anything where the deployment cannot remove sign-ins
  (the Volcengine deployment can; a Cloudflare Worker cannot). Ark resources
  and already submitted MA work are not touched.
- `PUT /v1/account/devices/:id`: `{name, platform: "mac" | "ios",
  app_version}` registers or refreshes one app install of the account, where
  `:id` is a random per-install UUID. Presence only: nothing is sent to devices.
  The name is sealed with the account. At most 20 devices per account; a new
  install beyond that returns 409 until one is forgotten.
- `GET /v1/account/devices`: `{devices: [{id, name, platform, app_version,
  last_seen_at}]}`, most recently seen first, for the signed-in account only.
- `DELETE /v1/account/devices/:id`: forgets one device; repeating it succeeds.
- `PUT /v1/account/upcoming`: `{session_id, language: "en" | "zh-CN", enabled,
  revision, confirm: true}` registers the account's main conversation for
  reminder delivery. Enabling reads the session with the account's key and
  accepts it only when it runs the account's own service-created agent (403
  otherwise). A stale revision returns 409. Delivery covers occurrences after it
  was first enabled; changing the conversation keeps that start.
- `GET /v1/account/upcoming`: `{enabled, session_id, language, since,
  revision, state}`, where `state` is `"session_unavailable"` once the
  conversation is gone or no longer runs the account's agent; register again to
  resume. `GET /v1/status` reports `upcoming: {delivery: "server" | "off",
  session_id}` for accounts; clients stop delivering locally while it names
  their main conversation.
- `GET /v1/account/workspace`: `{revision, workspace?, unconfirmed}` for the
  account's current key, where `workspace` is `{environmentId?, memoryStoreId?,
  agentId?, model}` from the sealed record. Creates nothing.
- `POST /v1/account/workspace`: `{credentialRevision, replaceUnconfirmed?,
  confirm: true}` creates any missing resource as described under Account
  workspaces and returns the same shape. 409 for a stale key revision, a
  concurrent device, an unconfirmed earlier creation, or a resource changed
  outside Open Muse; 503 when this creation's result is unconfirmed; 429 over the
  hourly limit.
- `PUT /v1/account/workspace/settings`: `{kind: "agent" | "environment",
  changes, revision, credentialRevision, confirm: true}`. Applies one change to
  the account's own recorded agent or environment (the target comes from the
  sealed record, not the request) and seals the settings Ark reports (agent
  version, name, description, model, system, tools, MCP servers, skills;
  environment name, description, config). Only those fields are accepted;
  `metadata`, uploaded (custom) skills, and `config.tos` are refused. Before
  anything is sent, the record is held with a pending marker by compare-and-swap
  on its revision, so a second device or a stale `revision` gets 409 without a
  request to Ark, and no change or setup runs while one is pending. The change is
  sent once. Only Ark's 400, 401, 403, 404, and 413 responses, or a 409 while
  the agent still has the change's base version, release the record as not
  applied (422). Timeouts, 408, 429, other statuses, network errors, unparsable
  responses, and a result that cannot be read back return 503
  `{code: "unconfirmed"}` and keep the record held. Settings that reference
  resources an account cannot use, or that are too large to seal, are never
  sealed; the record is held for review (409 `{code: "settings_review"}`).
  Whenever a change enters review, the account's background binding is revoked
  and its schedule paused in the same batch, because background sessions would
  use Ark's live values.
  A confirmed agent change
  rebinds allowed background work to the new version, which pauses its
  schedule; the response reports `background: "rebound" | "stale" |
  "unchanged"`. At most 60 changes per account per hour.
- `POST /v1/account/workspace/compare`: `{revision, credentialRevision,
  confirm: true}` reads Ark's current values for the resource under review
  (a held change or a drift) and returns `{revision, kind, current, saved,
  differs, unusable, tooLarge, expected}`: the settings fields Open Muse seals,
  which of them differ from the saved ones, which reference resources an
  account cannot use, and a fingerprint of exactly these values. Nothing is
  changed. The values go only to the account's verified session, like its
  sealed settings.
- `POST /v1/account/workspace/reconcile`: `{revision, credentialRevision,
  mode?: "adopt" | "discard", expected?, confirm: true}` resolves a held change
  or a drift by reading Ark only; nothing is sent to Ark. Without `mode` it reports
  `change: "applied"` when the agent shows the change at exactly the next
  version, which proves this one write executed. For an environment, which has
  no version, Ark showing the requested values is sealed but reported as
  `"matches_now"`: if the write had not executed yet, it may still arrive
  later and replace a later change, so the environment is marked as drifted
  and background work stops in the same batch. `"not_applied_yet"` is
  reported only while the agent is still at the
  change's base version; the record is released with the saved settings kept,
  and if the change arrives later the agent's version has moved, so the next
  change is refused and checked again instead of overwriting it. Any other
  result is 409 `{code: "settings_review"}`. After review, `mode: "adopt"`
  with the `expected` fingerprint from `compare` seals Ark's current values if
  an account may use them and they are still exactly the values the user
  reviewed; otherwise it returns 409 `{code: "settings_changed"}` and saves
  nothing (the user accepts the values as they are; an earlier unconfirmed
  write may still arrive), and `mode:
  "discard"` keeps the saved settings, reports `change: "discarded"` and
  `settings: "drift"` (Ark may differ from them), and in the same batch revokes
  background work and pauses its schedule; binding background work is refused
  while a drift or review is open. An agent's drift ends when a check finds Ark
  matching the saved settings, version included (`"drift_cleared"`), or when an
  agent change is confirmed, since a late write would move the version. An
  environment's drift ends only when the user adopts Ark's usable values or the
  environment is rebuilt after deletion; a matching read reports
  `"matches_now"` and a confirmed later change is sealed, but the drift stays
  (`"drift_kept"` when Ark differs). An agent change is accepted only on the
  version Open Muse saved: when Ark has another version, the change is refused
  before anything is sent and the agent is marked as drifted. A change still
  being sent is left alone for two minutes.

When a recorded agent or environment was deleted at Ark, `POST
/v1/account/workspace` creates it again from the account's saved settings and
reports `rebuilt: {agent|environment: "restored"}`. A restored agent starts a
new version history, so its saved settings take the new agent's version in the
same write. If the saved settings
reference resources an account cannot use, it returns 409
`{code: "rebuild_review", details}` and keeps them; only `resetSettings: true`
recreates the resource with default settings, reports
`"recreated_with_defaults"`, and keeps the replaced settings under
`previous`. Replacing a resource revokes the account's background binding and
pauses its schedule in the same batch. Changes made directly at Ark outside Open
Muse are not recorded.

### Account Ark credentials

The Ark API key is a model-service credential, not an identity. Each verified
Open Muse account owns at most one sealed `{apiKey, project}` record in
`account_credentials`. AES-256-GCM authenticates the purpose, account owner,
and revision with every ciphertext, so a row copied to another account or
revision cannot be decrypted. Two accounts that upload the same key keep
separate records. Every device signed in to the same account reads that
account's record.

Replacing or removing the key, in the same database transaction, also removes the account's
background binding, disables its schedule, and stops unfinished runs, so no
scheduled work continues with the previous key. The scheduled handler reseals up
to 20 rows per table under the current `CREDENTIAL_ENCRYPTION_KEYS` entry. Keep
a retired key in the keyring until no row reports it. Responses never include
the keyring. Only the owning account's `GET` returns the key.

Responses use `Cache-Control: no-store`. There is no wildcard CORS and no
cookie-based authentication. Origin checks do not replace token authentication.

## Background authorization

An account allows background work through `PUT /v1/connection` with
`{workspace, credentialRevision, revision, confirm: true}`, where `workspace`
holds only the agent ID and version, environment ID, and memory-store ID of its
own workspace. The service pairs them with the account's stored Ark key and
project. Account authentication and exact origin checks apply. Binding performs
only read-only Ark access checks; it never creates an MA resource or enables a
schedule. Ark keys, SSO access/refresh credentials, vaults, tools, and arbitrary
upstream URLs are not accepted. Native opt-in integration is described above.

Configure `CREDENTIAL_ENCRYPTION_KEYS` as a service secret containing a keyring:
`{"current":"v1","keys":{"v1":"<base64-encoded random 32-byte key>"}}`.
The entire bound configuration is AES-256-GCM encrypted with a fresh 96-bit
nonce and owner/revision-bound authenticated data. The database stores only the encrypted
envelope and non-secret revision/time metadata. The keyring never goes into the database,
an app, a response, or Git. This is encryption at rest, **not end-to-end
encryption**: the authorized service briefly decrypts the key to call Ark.
Administrators of the hosting platform with runtime or secret access remain trusted. HTTPS
protects requests in transit; do not enable request-body logging or tracing.

For rotation, add a new key ID and switch `current`, retaining previous keys
until all retained envelopes/backups have been migrated or expired. Do not
remove an old key prematurely. This version has no automated bulk re-encryption
or backup purge. Database backups can retain older ciphertext; removing
the live row is not proof of physical erasure from backups.

`DELETE /v1/connection` with `{revision, confirm: true}` removes the live encrypted
binding and leaves a revision tombstone. It atomically pauses future
scheduling, invalidates job leases, and clears pending prompts. Unsubmitted
local work stops; ambiguous submissions and already-running MA work require
review and are **not cancelled** upstream. Loaded invocations check revocation
before each further Ark request; an already in-flight request cannot be recalled.
Existing Feed posts remain. Removing the binding does not revoke the Ark key; use the Ark console to do that. Deletion is available even if the
encryption keyring is unavailable. Unresolved submissions can only be reconciled
after explicitly restoring the original connection and reviewing the run.

Credentials, schedules, job claims, run limits, results, and revocation are
scoped to the authenticated user. Each tick selects up to 20 oldest-due accounts
per invocation and creates a separate Ark adapter from each user's own
encrypted configuration. The adapter owner must match the task owner before
claiming work. A missing or unreadable user configuration cannot borrow another
user's key, and a failure for one user does not change another user's results.

The owner is an Open Muse account, not an Ark account or API-key owner. Multiple
accounts may store the same Ark key. Each still has a separate
owner-bound encrypted configuration, schedule, job state, result set, and
revocation operation. There is no global key-ownership registry and no
deduplication of users or connections by key. Revoking one account's binding does
not revoke another's; revoking the key at Ark affects everyone using it.

### End-user identity

Open Muse accounts identify users only through sessions the configured Auth
provider verifies. Only account owners (`muse_user_*`) are served or
scheduled; rows recorded under any other owner are never read. A random client UUID, a person's name or email, an Ark key,
an API-key digest, an Apple device ID, or a claimed user ID is not
authentication.

Account workspace resources are created only by the service for the requesting
account and recorded from its own creation responses; clients scope local
caches and pending actions with `accountWorkspaceKey(apiKey, project, owner)`.
Two accounts using the same key/project therefore get separate MA resources,
and the service refuses to bind a resource not recorded for the requesting
account. Legacy records are preserved and never assigned to a newly signed-in
account, and an account build never uses or uploads a device-held key. A
shared Ark key can grant direct upstream access to both users' resources:
application partitioning is not an Ark authorization boundary. Use separately
scoped Ark credentials if the users must not be able to access one another's
data outside Open Muse.

Different credentials/workspaces cannot replace an unresolved run's connection.
Unchanged bindings are deduplicated. Stale revisions fail instead of overwriting
a newer device's binding. There is no service-level Ark configuration and no
fallback to one.

The bound agent is version-pinned and reused with per-session overrides:
empty tools, MCP servers, and skills, plus a background-only system instruction.
Coordinator agents are rejected. The service verifies the effective session's
agent ID/version, the background system instruction, and empty execution
capabilities before submitting any message. Ark leaves an overridden empty list
out of the session, while an ignored override shows the agent's own list; a
present list or a different instruction stops the job for review. No source
agent is modified. Sessions mount neither memories nor credential vaults.
The server reads bounded SOUL, MEMORY, GOALS, and FEED documents into the prompt.
This mode produces personalized ideas, not web research or current news. It does
not access device-local likes or main-chat selection. Tool access remains out
of scope.

Only set `BACKGROUND_ENABLED=true` after real-account policy and connectivity
verification. Binding requires explicit native consent; local sign-out does not
remove a previous binding. This
service never accepts or stores a cloud management token in its runtime.

Creation/message markers are persisted before POST. Ambiguous results are
reconciled from MA history; a missing result is not proof of failure. Duplicate
markers, invalid output, unexpected approvals, configuration changes, and
monitoring deadlines require review. Logs and API errors do not echo upstream
payloads. Personal context may remain in a pending run until submission is
confirmed; the database is not application-level end-to-end encrypted.

## Deployment boundary

Deployment parameters and secrets (workspace ID, database host and password,
keyring, trigger secret) are passed to the deploy scripts through the
environment and never committed. The service's tables live in the `open_muse`
schema, outside the Supabase data API, and the function connects with a role
limited to them. For the Worker alternative, the checked-in Wrangler database
ID is a non-deployable placeholder; use ignored `wrangler.local.jsonc` for real
resource IDs and Worker secrets for keys. Cloud management credentials belong
only in local tooling, never in the service's runtime or an app bundle.

No cloud deployment, real MA call, or notification delivery is established by a
passing local build. [Deploying](DEPLOY.md) describes the Volcengine setup,
the Cloudflare alternative, and how to check a live deployment. Outbound Auth and Ark
requests use `redirect: "manual"` because Workers reject `"error"`; any redirect
response fails the request.

See [design boundaries](DESIGN.md) for authorization, uncertain-write recovery,
data residency, and later sync/notification work.
