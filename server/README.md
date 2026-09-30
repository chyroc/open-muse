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

This is a single-owner private deployment, not a public registration service.
Each authorized device uses a different random token. Only SHA-256 token hashes
are configured on the server; all tokens map to the deployment's `OWNER_ID`.
Never use an Ark API key or Cloudflare API token as a device token.
Device tokens must start with `muse_device_` and contain a random suffix.

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

- `DEVICE_TOKEN_HASHES`: a JSON object from SHA-256 device-token hashes to labels.
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
Keychain namespace, separate from Ark authentication. They do not copy or upload
existing Ark credentials. Signing out of Ark or removing the local background
connection does not pause the server schedule. Pause the schedule explicitly
before disconnecting if future automatic runs should stop. Revocation requires
removing the corresponding token hash on the server.

The settings card supports revision-checked schedule changes with explicit
consent, one-off generation, reviewed reconciliation, and recent runs. A pending
one-off operation ID is saved in Keychain before submission and reused after a
lost response or app restart; writes are not retried automatically. Refreshing
does not discard unsaved schedule edits. Feed content is cached in owner- and
origin-scoped IndexedDB for offline reading, without device tokens. Cached posts
remain on the device after disconnecting. Foreground and network-recovery events
refresh results; native background timers are not needed.

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

Configure `ARK_API_KEY` as a Worker secret and supply `ARK_PROJECT`,
`ARK_AGENT_ID`, `ARK_AGENT_VERSION`, `ARK_ENVIRONMENT_ID`, and
`ARK_MEMORY_STORE_ID` for one explicitly authorized workspace. These are server
configuration, not fields accepted from devices. Changing connection bindings
while a run is unresolved blocks reconciliation until the original binding is
restored and the run is reviewed. Never repoint this deployment to another owner.

The first version requires a dedicated agent with an explicit empty `tools`
array. It verifies the configured agent ID/version and empty tools before
generation and again before submission; administrators must not change this
agent while runs exist. Sessions mount neither memories nor credential vaults.
The server reads bounded SOUL, MEMORY, GOALS, and FEED documents into the prompt.
This mode produces personalized ideas, not web research or current news. It does
not access device-local likes or main-chat selection. Tool access and public
multi-user credential custody remain out of scope.

Only set `BACKGROUND_ENABLED=true` after real-account policy and connectivity
verification. No existing native credentials are copied automatically. This
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
