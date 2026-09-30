# Open Muse service

Cloudflare Workers API for the iOS and macOS apps. It verifies Muse account
sessions, keeps each account's Ark API key encrypted, records account workspace
ownership, and runs background Feed work. No website, static assets, chat
proxy, or native app binaries are hosted here. Clients call Ark directly with
the account's key.

## Current scope

The service supports explicit one-off Feed generation, a daily local-time
schedule, durable MA submission/reconciliation, and cursor-based Feed retrieval.
Background generation is disabled by default. Both native apps include the
controls in Settings, under **While you're away**. Background results currently
appear in that card, not in the main Feed tab. Push notifications are not
implemented.

Cron runs every five minutes; each invocation advances a persisted stage instead
of waiting for the agent. Generation and delivery are not exact-time guarantees.
Missed schedule occurrences do not create a catch-up burst. Nonexistent daylight
saving times are skipped. Only one unresolved run is allowed per owner, with at
most three new runs per rolling 24 hours, including manual requests. After an
hour of monitoring, a run requires explicit review; this does not stop MA or
guarantee a model-spend cap. Pausing a schedule stops future automatic dispatch,
not already queued or running work.

Private deployments can also enroll devices without accounts. Each authorized
device uses a different random token.
Only SHA-256 token hashes are configured on the server; each hash maps to a
trusted `{ownerId, deviceLabel}` record. Different devices belonging to the same
user share that user's stable, opaque `ownerId`. Different users must receive
different IDs and tokens. The service derives ownership from this trusted
binding, never from a submitted name, query string, or resource ID. Old
label-only device maps are rejected rather than silently sharing one account.
Never use an Ark API key or Cloudflare API token as a device token.
Device tokens must start with `muse_device_` and contain a random suffix.

## Muse accounts

The API accepts end-user access tokens from one explicitly configured
Supabase Auth provider, including the Volcano-hosted Supabase service. Configure
`SUPABASE_AUTH_URL` as its public HTTPS origin and `SUPABASE_ANON_KEY` as its anon
or publishable key. Never configure a service-role key. The Worker verifies each
request with the provider's read-only `/auth/v1/user` endpoint. Invalid sessions
are rejected; provider failures return 503 without falling back to another
identity. No token claims, client metadata, names, or emails select the owner.
The stable Muse owner is derived from the configured issuer and verified user
UUID, so different devices retain one identity and different accounts remain
separate even if they share an Ark key.

An account uses only the Ark key it stored through
`/v1/account/credential`; it never inherits the service-level `ARK_*`
configuration or the private owner's data. The status response reports
`account: {provider, credential: {configured, revision, updatedAt}}`. To allow
background work, an account sends only its workspace resource IDs to
`PUT /v1/connection` as `{workspace, credentialRevision, revision, confirm}`.
The Worker pairs them with the account's stored key, verifies them read-only,
and seals the result. A binding prepared for an older key revision returns 409.
Schedules and runs then work as for private devices, and the scheduler resolves
each account's own sealed binding.

### Account workspaces

Read access proves nothing when accounts share a key, so the Worker, not the
client, creates each account's agent, environment, and memory store with the
account's stored key (`POST /v1/account/workspace`). It records every resource
in `account_resources` for that account from its own creation response, in the
same D1 batch that updates the account's sealed workspace record. Nothing is
ever recorded from a label, a list, or client input, so relabelling a resource
outside Open Muse or racing its creation cannot make it another account's.
Clients never discover or adopt account resources by label.

Creation is sent once. Before each POST the Worker stores a pending marker with
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
requesting account; this is checked before the Worker reads any resource, so it
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

Only one configured issuer is accepted. Device-token enrollment remains available
independently, and device owners cannot claim account owner IDs. Public signup
policy, provider rate limiting, email verification, SMTP, and abuse protection
are configured at Supabase. The Worker never needs an Auth administrative key,
password, provider refresh token, or database connection string. CORS and
native connectivity require live acceptance.

### Native email login

Configure the app build with `VITE_MUSE_BACKGROUND_URL`,
`VITE_MUSE_SUPABASE_URL`, and `VITE_MUSE_SUPABASE_ANON_KEY`. These are a public
API origin, a public Auth origin, and an anon/publishable key; service-role JWTs
and secret keys are rejected. The exact Auth origin is added to both Apple
clients' connection policies. Do not put credentials in URLs or tracked files.
Builds without Auth configuration run in single-user local mode, retain
private-device-token enrollment, and make no Supabase requests.

The **Muse account** settings card supports email/password signup and login.
Signup requires explicit confirmation and does not count as a confirmed login;
follow the provider's email-verification policy, then sign in. Passwords are
sent directly to Auth and never saved. Only after the Worker confirms the same
user is the access/refresh session stored in the separate background Keychain
entry (sessionStorage on web, not supported on Android). No account token or
password goes into IndexedDB, a URL, logs, or Cloudflare storage.

The client renews the session shortly before the access token expires, at the
start of an operation, and also on explicit request. Before the one refresh POST
it saves a pending marker; an ambiguous outcome requires signing out and in
again, never replaying the potentially rotated refresh token. A successful
same-user refresh is saved immediately, before the Worker check. Web Locks
coordinate renewal across windows and a saved-session comparison rejects stale
windows. Devices without Web Locks must sign in again instead. Signing out sends
one `POST /auth/v1/logout?scope=local` and always removes the local session;
other devices stay signed in. Account deletion, password reset, and OAuth
callbacks are not implemented.

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
provider signup/email policy, and native-to-Auth plus Worker-to-Auth
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

`build` bundles the Worker with Wrangler's dry-run mode. It does not deploy or
create cloud resources. Tests run against a local Miniflare D1 database with
mocked upstream calls. Development listens on port 4311.

Configure local bindings in ignored `.dev.vars`:

- `DEVICE_TOKEN_HASHES`: a JSON object from SHA-256 device-token hashes to
  `{ownerId, deviceLabel}` records (maximum 200 devices).
  Missing or malformed configuration disables authenticated endpoints.
- `ALLOWED_ORIGINS`: comma-separated exact origins for the native WebViews,
  typically `capacitor://localhost,muse://app`. Verify the actual app origins.
  Requests with no Origin still require authentication. Opaque `null` origins
  and non-allowlisted origins are rejected.

Store device tokens in native Keychain. Remove a hash to revoke that device.
Never put tokens in tracked config, URLs, screenshots, logs, or build variables.

## Native app connection

After deploying the private API, set `VITE_MUSE_BACKGROUND_URL` in the build
process environment for each app. It is a public HTTPS origin, not a secret;
paths, credentials, query strings, and fragments are rejected. For example:

```sh
VITE_MUSE_BACKGROUND_URL=https://background.example.com npm run macos:build
VITE_MUSE_BACKGROUND_URL=https://background.example.com npm run ios:build
```

Run these commands from the repository root. Only this exact API origin is
added to the app's connection policy. Builds without the variable have no
background connection and make no requests to this service. Existing Ark
requests still go directly to the existing allowlisted Volcano endpoints.

Enter a separate device token in each app. iOS and macOS store it in a dedicated
Keychain namespace, separate from Ark authentication. Connecting a device token
alone does not upload Ark credentials. Signing out of Ark or removing the local
background connection does not pause the server schedule. Pause the schedule
explicitly before disconnecting if future automatic runs should stop. Revocation
requires removing the corresponding token hash on the server.

The settings card supports revision-checked schedule changes with explicit
consent, one-off generation, reviewed reconciliation, and recent runs. A pending
one-off operation ID is saved in Keychain before submission and reused after a
lost response or app restart; writes are not retried automatically. Refreshing
does not discard unsaved schedule edits. Feed content is cached in owner- and
origin-scoped IndexedDB for offline reading, without device tokens. Cached posts
remain on the device after disconnecting. Foreground and network-recovery events
refresh results; native background timers are not needed.

After connecting the private service, authorize **Sync current Ark configuration**
in the settings card to upload the existing app login's data-plane API key and
prepared workspace references. No key or resource ID needs to be entered again.
The existing local workspace and personal memory must already be prepared;
sync does not silently create cloud resources. Upload is not automatic on
startup, refresh, login, or account switching. A replacement upload pauses the
schedule; explicitly review and enable it again. Signing out locally does not
remove uploaded access. Use **Remove uploaded Ark access** to revoke the server
copy and pause the schedule; this is separate from removing the device token.

This integration targets iOS and macOS. It has local client, UI, and build
verification, but requires live origin/CORS, Keychain, and MA acceptance before
use. In particular, a passing build does not prove that a configured service is
deployed or that a real unattended generation can complete.

## API

- `GET /health`: public liveness only; no configuration or credentials.
- `GET /v1/status`: requires `Authorization: Bearer <device-token>`; checks D1.
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
- `GET /v1/account/credential`: Muse account sessions only. Returns
  `{configured, revision, updatedAt, credential?}` where `credential` is the
  account's own `{apiKey, project}`. Device tokens receive 403.
- `PUT /v1/account/credential`: `{credential, revision, confirm: true}`. The key
  is checked with one read-only Ark request (`GET /agents?limit=1`) and then
  sealed for this account. A stale revision from another device returns 409.
- `DELETE /v1/account/credential`: `{revision, confirm: true}` leaves a
  tombstone for this account only.
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
  resources an account cannot use are never sealed. A confirmed agent change
  rebinds allowed background work to the new version, which pauses its
  schedule; the response reports `background: "rebound" | "stale" |
  "unchanged"`. At most 60 changes per account per hour.
- `POST /v1/account/workspace/reconcile`: `{revision, credentialRevision,
  adopt?, confirm: true}` resolves a held change by reading Ark only. It reports
  `change: "applied"` (sealed), `"not_applied"` (released, saved settings kept),
  or 409 `{code: "settings_review"}` when Ark's values match neither, in which
  case only `adopt: true` after the user's review seals the current values. A
  change still being sent is left alone for two minutes.

When a recorded agent or environment was deleted at Ark, `POST
/v1/account/workspace` creates it again from the account's saved settings and
reports `rebuilt: {agent|environment: "restored"}`. If the saved settings
reference resources an account cannot use, it returns 409
`{code: "rebuild_review", details}` and keeps them; only `resetSettings: true`
recreates the resource with default settings, reports
`"recreated_with_defaults"`, and keeps the replaced settings under
`previous`. Replacing a resource revokes the account's background binding and
pauses its schedule in the same batch. Changes made directly at Ark outside Open
Muse are not recorded.

### Account Ark credentials

The Ark API key is a model-service credential, not an identity. Each verified
Muse account owns at most one sealed `{apiKey, project}` record in
`account_credentials`. AES-256-GCM authenticates the purpose, account owner,
and revision with every ciphertext, so a row copied to another account or
revision cannot be decrypted. Two accounts that upload the same key keep
separate records. Every device signed in to the same account reads that
account's record.

Replacing or removing the key, in the same D1 batch, also removes the account's
background binding, disables its schedule, and stops unfinished runs, so no
scheduled work continues with the previous key. The scheduled handler reseals up
to 20 rows per table under the current `CREDENTIAL_ENCRYPTION_KEYS` entry. Keep
a retired key in the keyring until no row reports it. Responses never include
the keyring. Only the owning account's `GET` returns the key.

Responses use `Cache-Control: no-store`. There is no wildcard CORS and no
cookie-based authentication. Origin checks do not replace token authentication.

## Background authorization

The private API accepts the existing app's Ark API key, project, agent ID and
version, environment ID, and memory-store ID through `PUT /v1/connection` with
`{config, revision, confirm: true}`. Device authentication and exact origin checks
apply. Upload performs only read-only Ark access checks; it never creates an MA
resource or enables a schedule. SSO access/refresh credentials, vaults, tools,
and arbitrary upstream URLs are not accepted. No separate Ark key or agent is
required. Native opt-in integration is described above.

Configure `CREDENTIAL_ENCRYPTION_KEYS` as a Worker secret containing a keyring:
`{"current":"v1","keys":{"v1":"<base64-encoded random 32-byte key>"}}`.
The entire uploaded configuration is AES-256-GCM encrypted with a fresh 96-bit
nonce and owner/revision-bound authenticated data. D1 stores only the encrypted
envelope and non-secret revision/time metadata. The keyring never goes into D1,
an app, a response, or Git. This is encryption at rest, **not end-to-end
encryption**: the authorized Worker briefly decrypts the key to call Ark.
Cloudflare administrators with runtime/secret access remain trusted. HTTPS
protects uploads in transit; do not enable request-body logging or tracing.

For rotation, add a new key ID and switch `current`, retaining previous keys
until all retained envelopes/backups have been migrated or expired. Do not
remove an old key prematurely. This version has no automated bulk re-encryption
or backup purge. D1 Time Travel/backups can retain older ciphertext; removing
the live row is not proof of physical erasure from backups.

`DELETE /v1/connection` with `{revision, confirm: true}` removes the live encrypted
configuration and leaves a revision tombstone. It atomically pauses future
scheduling, invalidates job leases, and clears pending prompts. Unsubmitted
local work stops; ambiguous submissions and already-running MA work require
review and are **not cancelled** upstream. Loaded invocations check revocation
before each further Ark request; an already in-flight request cannot be recalled.
Existing Feed posts remain. Removing the upload does not revoke the original
Ark key; use the Ark console to do that. Deletion is available even if the
encryption keyring is unavailable. Unresolved submissions can only be reconciled
after explicitly restoring the original connection and reviewing the run.

Credentials, schedules, job claims, run limits, results, and revocation are
scoped to the authenticated user. Cron selects up to 20 oldest-due authorized
users per invocation and creates a separate Ark adapter from each user's own
encrypted configuration. The adapter owner must match the task owner before
claiming work. A missing or unreadable user configuration cannot borrow another
user's key, and a failure for one user does not change another user's results.

The owner is an Open Muse end user, not an Ark account or API-key owner. Multiple
users may explicitly upload the same Ark key. Each still has a separate
owner-bound encrypted configuration, schedule, job state, result set, and
revocation operation. There is no global key-ownership registry and no
deduplication of users or connections by key. Revoking one user's upload does
not revoke another user's upload; revoking the key at Ark affects everyone
using it. Device enrollment is a trusted administrative operation; end users
sign in with Muse accounts as described above.

### End-user identity

Device tokens identify users only through the trusted server-side enrollment
binding. Muse accounts identify users only through sessions the configured Auth
provider verifies. A random client UUID, a person's name or email, an Ark key,
an API-key digest, an Apple device ID, or a claimed user ID is not
authentication.

Account workspace resources are created only by the Worker for the requesting
account and recorded from its own creation responses; clients scope local
caches and pending actions with `accountWorkspaceKey(apiKey, project, owner)`.
Two accounts using the same key/project therefore get separate MA resources,
and the Worker refuses to bind a resource not recorded for the requesting
account. Legacy records are preserved and never assigned to a newly signed-in
account; an earlier device-held key is used only after the user explicitly saves
it to the account. A shared Ark key can grant direct upstream access to both
users' resources: application partitioning is not an Ark authorization
boundary. Use separately scoped Ark credentials if the users must not be able
to access one another's data outside Open Muse.

Different credentials/workspaces cannot replace an unresolved run's connection.
Unchanged syncs are deduplicated. Stale revisions fail instead of overwriting a
newer device's upload. Older service-level `ARK_*` bindings remain supported for
existing private deployments **only** when there is exactly one authorized
owner matching `OWNER_ID`. They are never a shared multi-user fallback.
A revocation tombstone also disables the fallback. `OWNER_ID` no longer selects
an HTTP request's owner. Migrate device-token maps before deploying this version.

The uploaded app agent is version-pinned and reused with per-session overrides:
empty tools, MCP servers, and skills, plus a background-only system instruction.
Coordinator agents are rejected. The Worker verifies the effective session's
agent ID/version and empty execution capabilities before submitting any message.
If Ark omits or ignores those restrictions, the job stops for review. No source
agent is modified. This contract still requires live MA acceptance. Sessions
mount neither memories nor credential vaults.
The server reads bounded SOUL, MEMORY, GOALS, and FEED documents into the prompt.
This mode produces personalized ideas, not web research or current news. It does
not access device-local likes or main-chat selection. Tool access remains out
of scope.

Only set `BACKGROUND_ENABLED=true` after real-account policy and connectivity
verification. Upload requires explicit native consent; local sign-out does not
remove previously uploaded authorization. This
service never accepts or stores the Cloudflare management token in its runtime.

Creation/message markers are persisted before POST. Ambiguous results are
reconciled from MA history; a missing result is not proof of failure. Duplicate
markers, invalid output, unexpected approvals, configuration changes, and
monitoring deadlines require review. Logs and API errors do not echo upstream
payloads. Personal context may remain in a pending run until submission is
confirmed; D1 is not application-level end-to-end encrypted.

## Deployment boundary

The checked-in Wrangler database ID is a non-deployable placeholder. Create an
app-specific D1 database and use ignored `wrangler.local.jsonc` for actual
resource IDs. Apply migrations before deploying. Configure device-token hashes
with Worker secrets rather than committing them. Cloudflare management tokens
belong only in local tooling, never in Worker bindings or an app bundle.

No cloud deployment, real MA call, or notification delivery is established by a
passing local build. Do not enable scheduled generation until the dedicated MA
configuration, limits, and access policy have been verified.

See [design boundaries](DESIGN.md) for authorization, uncertain-write recovery,
data residency, and later sync/notification work.
