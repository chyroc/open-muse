# Background Feed service

Optional Cloudflare Workers API for the iOS and macOS apps. No website, static
assets, chat proxy, or native app binaries are hosted here. Direct Ark usage
remains independent of this service.

## Current scope

The service supports explicit one-off Feed generation, a daily local-time
schedule, durable MA submission/reconciliation, and cursor-based Feed retrieval.
It is disabled by default. Both native apps include an optional connection in
Settings, under **While you're away**. Background results currently appear in
that card, not in the main Feed tab. Push notifications are not implemented.

Cron runs every five minutes; each invocation advances a persisted stage instead
of waiting for the agent. Generation and delivery are not exact-time guarantees.
Missed schedule occurrences do not create a catch-up burst. Nonexistent daylight
saving times are skipped. Only one unresolved run is allowed per owner, with at
most three new runs per rolling 24 hours, including manual requests. After an
hour of monitoring, a run requires explicit review; this does not stop MA or
guarantee a model-spend cap. Pausing a schedule stops future automatic dispatch,
not already queued or running work.

This is a privately provisioned, user-isolated deployment, not a public
registration service. Each authorized device uses a different random token.
Only SHA-256 token hashes are configured on the server; each hash maps to a
trusted `{ownerId, deviceLabel}` record. Different devices belonging to the same
user share that user's stable, opaque `ownerId`. Different users must receive
different IDs and tokens. The service derives ownership from this trusted
binding, never from a submitted name, query string, or resource ID. Old
label-only device maps are rejected rather than silently sharing one account.
Never use an Ark API key or Cloudflare API token as a device token.
Device tokens must start with `muse_device_` and contain a random suffix.

## Supabase Auth trial

The API also accepts end-user access tokens from one explicitly configured
Supabase Auth provider, including the Volcano-hosted Supabase service. Configure
`SUPABASE_AUTH_URL` as its public HTTPS origin and `SUPABASE_ANON_KEY` as its anon
or publishable key. Never configure a service-role key. The Worker verifies each
request with the provider's read-only `/auth/v1/user` endpoint. Invalid sessions
are rejected; provider failures return 503 without falling back to another
identity. No token claims, client metadata, names, or emails select the owner.
The stable Muse owner is derived from the configured issuer and verified user
UUID, so different devices retain one identity and different accounts remain
separate even if they share an Ark key.

This is an authentication-only trial. Supabase users cannot upload Ark
credentials, enable background generation, or inherit the old private owner's
data. The status response identifies the account provider and reports
`workspaceReady: false`. The direct client's existing workspace and memory
selection has not been migrated to Muse accounts; local Ark login still works
independently. Do not claim complete account-based native data isolation from
this login trial. No existing data or private-device bindings are migrated.

Only one configured issuer is accepted. Device-token enrollment remains available
independently. Public signup policy, provider rate limiting, email verification,
SMTP, and abuse protection are configured at Supabase. The Worker never needs
an Auth administrative key, password, provider refresh token, or database
connection string. CORS and native connectivity require live acceptance.

### Native email login

Configure the app build with `VITE_MUSE_BACKGROUND_URL`,
`VITE_MUSE_SUPABASE_URL`, and `VITE_MUSE_SUPABASE_ANON_KEY`. These are a public
API origin, a public Auth origin, and an anon/publishable key; service-role JWTs
and secret keys are rejected. The exact Auth origin is added to both Apple
clients' connection policies. Do not put credentials in URLs or tracked files.
Builds without Auth configuration retain private-device-token enrollment and
make no Supabase requests.

The optional settings card supports email/password signup and login. Signup
requires explicit confirmation and does not count as a confirmed login; follow
the provider's email-verification policy, then sign in. Passwords are sent
directly to Auth and never saved. Only after the Worker confirms the same user
is the access/refresh session stored in the existing separate background
Keychain entry (sessionStorage on web, not supported on Android). No account
token or password goes into IndexedDB, a URL, logs, or Cloudflare storage.

Login renewal is explicit, not timer-driven. Before the one refresh POST the
client saves a pending marker; an ambiguous outcome requires disconnecting and
signing in again, never replaying the potentially rotated refresh token. A
successful same-user refresh is saved immediately, before the Worker check. Web
Locks coordinate renewal across windows and a saved-session comparison rejects
stale windows. Devices without Web Locks must sign in again instead. Disconnect
removes this app's local session only; it does not revoke all provider sessions
or delete the account. Account deletion, password reset, OAuth callbacks,
Apple capabilities, and an end-user workspace migration are not implemented.

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
using it. Device enrollment is a trusted administrative operation. Public
sign-up and end-user login are not implemented.

### End-user identity and rollout prerequisite

Device tokens identify users only through the trusted server-side enrollment
binding. A random client UUID, a person's name, an Ark key, an API-key digest,
an Apple device ID, or a claimed user ID is not authentication. Multiple devices
share one owner only after trusted enrollment; a new device is not automatically
recognized as the same person.

The current direct iOS/macOS client derives workspace and personal-memory
metadata from the Ark endpoint/key/project digest, not from a separate Muse
account. Two people using the same key/project can therefore discover the same
MA memory store and workspace. Server-side D1 isolation does not repair this
upstream sharing. Do not enable unattended multi-user generation until client
identity, resource provisioning, and legacy-data migration have been addressed.
Tests cover separate per-user resources, including users sharing a key; they
do not establish end-to-end native account isolation.

For native account onboarding, the proposed default is Sign in with Apple on
both iOS and macOS. Verify Apple's token signature, issuer, allowed app audience,
expiry, and login-challenge nonce on the Worker, then map the verified provider
subject to a server-issued stable Muse user ID. Do not trust a client-submitted
subject or use an email/name as the identifier. Configure the app identifiers
for shared Apple identity before linking iOS/macOS accounts. Issue separate
revocable device sessions stored in Keychain and derive every request's owner
from the verified session. Apple login and its signing/capability setup are
proposed, not implemented by this private-token service.

Client workspace metadata and memory-store provisioning must use that Muse user
ID (plus a separate connection/workspace ID), not the key digest. Personal
memory, session selection, local caches, and pending actions must remain scoped
to that identity. Preserve legacy records; do not automatically assign a
previously shared memory store to a newly logged-in user. A shared Ark key can
grant direct upstream access to both users' resources: application partitioning
is not an Ark authorization boundary. Use separately scoped Ark credentials if
the users must not be able to access one another's data outside Open Muse.

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
not access device-local likes or main-chat selection. Tool access and public
multi-user credential custody remain out of scope.

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
