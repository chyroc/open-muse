# Backend design boundaries

This document records design boundaries and future expansion, not a feature
status checklist. See [README](README.md) for implemented behavior and setup.

The application still connects directly to Volcano APIs. Keep that mode usable
without an Open Muse account or backend. The service owns application sync
and orchestration; it does not replace Ark Managed Agents (MA).

The target clients are iOS and macOS. Their UI assets remain bundled with the
apps; static website hosting and Web Push are out of scope. The service
exposes an HTTPS API and runs background coordination; it does not serve
the application UI. Web and Android work is not part of this plan.

## Placement decisions

| Capability                                   | Current implementation                                                                                                         | Proposed placement                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Saved replies                                | Device-local IndexedDB in [`src/api.ts`](../src/api.ts)                                                                        | Workers API + D1, with explicit sync opt-in and original session/event references                                            |
| Feed/Ideas presentation                      | Local post indexes, likes, dismissed instructions, and discussion links in [`DirectInspiration`](../src/direct/inspiration.ts) | D1 for synced presentation records; MA events remain the source of generated content                                         |
| Conversation preferences                     | Local archive state, main-chat selection, and chapter links in [`Conversations`](../src/direct/conversations.ts)               | D1 eventually; shared main-chat coordination is a separate change, not a blind index upload                                  |
| Goals and personal documents                 | `GOALS.md`, `SOUL.md`, `MEMORY.md`, `IDENTITY.md`, and `FEED.md` in MA memory                                                  | Keep MA authoritative; do not create a second writable copy in D1                                                            |
| Periodic Feed and goal check-ins             | Not implemented; generation is explicitly user-triggered                                                                       | Workers Cron + durable job records in D1; add Queues or Workflows when needed                                                |
| Notifications and external events            | No background delivery or incoming webhook service                                                                             | Workers for authenticated webhooks and APNs calls; separate iOS and macOS notification integration is also required          |
| App-owned attachments or exports             | No separate app object store                                                                                                   | Consider R2 later if needed; do not duplicate existing MA files by default                                                   |
| Agent execution, sandbox, tools, and history | MA                                                                                                                             | Keep in MA; do not move the execution loop, Chrome, or Lark CLI into a Worker                                                |
| Ark sign-in and device credentials           | [`DirectAuth`](../src/direct/auth.ts) and device credential storage                                                            | Keep device-local for direct use and sync-only mode; background MA access requires a separate, explicit authorization design |

Current goals already use MA memory through
[`DirectGoals`](../src/direct/goals.ts). IndexedDB retains legacy goals and
migration bookkeeping, not a new cloud source of truth. A goal record is not a
scheduled job: completing or pausing a goal does not currently stop execution.

## Future slice: saved-reply sync

Start with one authenticated Workers API and one D1 database. Do not provision
R2, Queues, Durable Objects, or a general MA gateway for this slice.

- Introduce a stable Open Muse user ID and a separate workspace/connection ID.
  Choose and verify a native login flow for both iOS and macOS before exposing
  private data. For OAuth/OIDC, use the system authentication session/browser,
  PKCE, and validated app callbacks. Store refresh credentials in Keychain, not
  bundled configuration or IndexedDB. Ark login is not automatically Open Muse
  login.
- Do not use the current API-key digest as a user ID or authentication token.
  It partitions device-local data but changes with key rotation and does not
  establish a server-authenticated identity.
- Start with user/workspace ownership and saved-reply records. Preserve the
  original `session_id` and `event_id`; deduplicate within the workspace using
  those references. Uploaded content is a client-provided snapshot, not proof
  that the server verified an MA response.
- Derive ownership from the authenticated session and check it on every read
  and write. A submitted user ID, workspace ID, or MA resource ID is not proof
  of access. Sync-only mode must not require uploading Ark API keys.
- Make upload explicit. Saved replies and feed posts can contain sensitive
  conversation content even when no API key is present. Define retention,
  export, deletion, and backup recovery before enabling sync for other users.
- Keep local copies and direct MA access available during outages. Use a local
  outbox, stable mutation IDs, server-assigned revisions, and incremental sync
  cursors. Replayed mutations must not duplicate records; conflicting edits
  must preserve the local draft. Use tombstones for deletions so stale devices
  cannot resurrect removed records.
- Isolate the outbox by authenticated user and workspace. Signing out or
  switching accounts must never upload the previous account's pending data.
  Retain existing local data until migration has been verified.
- Sync on app launch, foreground activation, explicit refresh, and local
  mutations. Reconcile pending changes after offline use or process termination.
  Do not depend on an iOS background timer or an always-running macOS process.
  Both clients need their own opt-in, conflict, and recovery UI; changes to the
  shared client do not establish feature parity or platform acceptance.

After this slice works, extend the same sync contract to Feed/Ideas indexes and
reactions. Preserve provenance, and deduplicate posts by source session/event
and item position rather than assuming device-local generation tokens match.

Archive preferences can follow. Do not sync `pending` or `sending` flags as
ordinary preferences. Shared main-chat selection and continuation require
coordinated claims and reconciliation across participating clients. A D1 lock
does not constrain older clients that still write directly to MA; mixed-version
behavior must be defined before claiming cross-device safety.

## First product slice: background generation; notifications follow

Background generation changes the trust model. It is not enabled merely by
deploying a Worker or writing a cron expression.

1. Obtain explicit authorization to call MA while the user is offline. Specify
   credential scope, encrypted storage, rotation, revocation, and deletion.
   Never store plaintext user keys in D1, job payloads, source, or logs. Worker
   secrets can protect service-level secrets but are not, by themselves, a
   complete multi-user credential-management design.
2. Resolve and verify the authorized MA workspace before dispatch. Do not
   accept arbitrary upstream URLs or resource IDs as authorization. Keep
   upstream origins fixed and reject credential-bearing redirects.
3. Store schedules separately from goals, with explicit opt-in, timezone,
   enabled state, next execution time, and bounded run/concurrency budgets.
   Cron uses UTC; translate user schedules deliberately. Missed ticks must not
   trigger an unbounded catch-up burst. MA costs are separate from Cloudflare
   charges, and run limits are not an exact model-spend cap.
4. Atomically claim a due run and persist its operation marker before sending
   anything to MA. Submit work to a dedicated MA session, persist the session
   and event IDs, then reconcile progress in later invocations. Do not hold an
   HTTP request or an in-memory timer open until the agent finishes.
5. Treat retries and queue redelivery as normal. A database uniqueness check
   alone cannot guarantee exactly-once execution of an external MA request.
   After an ambiguous creation or send, query history using the persisted
   marker; if the outcome is still unknown, retain that state and do not resend.
6. Start with read-only research. A prompt alone is not a permission boundary:
   configure and verify a suitable MA tool policy for unattended work rather
   than inheriting the current app agent's broad tool permissions. The private
   implementation accepts an explicit encrypted upload and reuses its agent
   only with verified no-tools session overrides. Approval-required
   actions must wait for the user. Do not enable autonomous memory maintenance
   or goal edits as a side effect of adding scheduled Feed generation.
7. Read the authoritative MA documents and history to build context. Retain only
   the minimum job metadata and derived result index in D1; minimize prompt and
   conversation retention. MA has no atomic document compare-and-swap contract,
   so a server lock cannot prevent simultaneous agent-side memory edits.
8. Persist a notification outbox after confirmed completion. Deduplicate sends,
   support quiet hours and revocation, and avoid private content in default
   push payloads. APNs credentials, each app's signing/entitlements, topics,
   sandbox/production environments, user permission, and device-token lifecycle
   require separate iOS and macOS integration and acceptance tests. Unlink tokens
   on sign-out and remove invalid registrations. Push delivery is not guaranteed:
   notification taps and app foregrounding must fetch authoritative state, and
   missed pushes must not lose results. Do not rely on silent pushes to run the
   scheduler. Use server-side polling unless an actual MA callback contract has
   been verified; do not assume webhooks exist.

## Decision: scheduled tasks run with the full agent

Reminders and recurring tasks from `UPCOMING.md` are delivered by the service
into the account's main conversation and handled by the account's agent with its
normal toolset, as if the person had asked at that time. This is a deliberate
exception to the read-only rule above for background Feed runs, chosen by the
product owner. It is bounded by: items the person set up in chat; a main
conversation registered by the signed-in account and verified to run its own
agent; claim-before-send with a persisted event ID and no resend; no delivery
while the conversation is busy or awaiting an approval or a client tool result;
per-account message limits; and the same issuer and recent-activity gate as
other account work. Steps that require approval still wait for the user.

## Runtime and security boundaries

- Reuse pure schemas and helpers from `shared/` where compatible, such as
  inspiration parsing and goal validation. Evaluate [`ArkClient`](../shared/ark.ts)
  in Worker-runtime tests before reuse. Do not import `src/api.ts` or
  `src/direct/*` wholesale: they depend on browser storage and native bridges.
- Add a separate client for the optional sync API. Do not weaken
  [`directFetch`](../src/direct/transport.ts) or forward Ark authorization headers
  to Cloudflare. Update each native shell's CSP and exact allowed WebView origins
  deliberately; CORS is not authentication. Validate application access tokens
  on the server, and protect cookie-based mutations against CSRF if used.
- Keep API and private sync responses out of shared caches. Redact secrets and
  private payloads from logs, and add request-size limits and per-user quotas.
- Keep secrets and production resource IDs out of the repository. A later
  implementation should isolate server dependencies, local state, migrations,
  configuration, and tests under this directory. Integrate a client API adapter
  into each native app separately; never bundle server code or server secrets.
- Use persisted jobs for durable work. Workers have CPU, memory, and invocation
  lifetime limits; response completion or client disconnection is not a durable
  background execution mechanism.
- The primary deployment runs on Volcengine in cn-beijing (Supabase Edge
  Function, Postgres, Auth, and a veFaaS timer), reachable from mainland
  networks and close to Ark; see [Deploying](DEPLOY.md). `*.workers.dev` is not
  reliably reachable from mainland networks, so a Cloudflare deployment for
  mainland users needs a custom domain. Ordinary Cloudflare deployment does not imply mainland hosting; China Network has separate availability, product,
  subscription, and ICP requirements. Review data residency before uploading
  personal content.

## Delivery sequence and acceptance gates

1. **Scheduled Feed:** implement authenticated device access and durable tasks.
   Enable MA submission only after background credentials and tool restrictions
   are verified. Test duplicate ticks, worker crashes, ambiguous upstream writes,
   revoked access, MA throttling, and budget exhaustion. Verify execution with
   both apps closed and result recovery when either app reopens.
2. **iOS/macOS saved-reply sync:** implement native login, tenant isolation, D1
   migrations, the sync API, and opt-in integration in both clients. Verify a
   reply saved on iOS appears on macOS and vice versa, including each app's UI.
   Test Keychain persistence, relaunch, offline/foreground recovery, account
   switching, conflicting edits, deletion, duplicate mutations, and backup
   restoration. The direct-only mode must still work. Use an iPhone and a Mac
   for acceptance; shared or simulator tests alone do not establish both.
3. **Additional sync:** add Feed/Ideas presentation and archive preferences.
   Treat shared main-chat creation/continuation as a separately tested feature,
   including mixed client versions and ambiguous MA writes.
4. **APNs delivery and expansion:** verify push registration, permissions,
   notification navigation, and missed-delivery recovery separately on iOS and
   macOS. Then consider goal check-ins, signed incoming webhooks, and R2 only for
   demonstrated needs.

No cloud resources or credentials are required to review this proposal. The
login provider, production API endpoint, credential custody design, data residency,
and operating budget remain decisions to make before the relevant phase.

## Cloudflare references

- [D1](https://developers.cloudflare.com/d1/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [China Network](https://developers.cloudflare.com/china-network/)
