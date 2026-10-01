# Open Muse

A personal AI task assistant built on Volcano Ark Managed Agents (MA). The web,
iOS, Android, and macOS apps connect directly to Volcano APIs. No Open Muse
backend, local API service, app access token, or server URL is required.

Conversations use real MA responses. Without an Ark connection the app stays
signed out; network failures never produce simulated replies. Cloud calls and
cloud environments may incur charges.

Current feature development and acceptance focus on iOS. The other platform
projects are retained; shared-client changes do not establish platform-specific
verification. See [verification coverage](docs/verification.md) for limitations.

## Run and build

Requires Node.js 22.21+ for development. Apple builds require Xcode; Android
builds require JDK 21 and Android SDK 36.

```bash
npm ci
npm run dev           # Static frontend development on port 4310
npm run check         # Type checks and regression tests
npm run build         # Static site in dist/
npm start             # Preview the static site on port 4310
npm run macos:build   # .build/macos/Open Muse.app
npm run ios:build     # iOS Simulator app
npm run native:sync   # Build and sync the iOS and Android bundles
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). Deploy `dist/` to any
trusted HTTPS static host. The static host serves assets only; it never receives
Ark credentials or proxies API requests. Native apps bundle these same assets.
Do not place credentials in build-time environment variables or source files;
the three account build values described below are public.

## Muse accounts

Release builds set three public values at build time: `VITE_MUSE_BACKGROUND_URL`
(the Open Muse service origin), `VITE_MUSE_SUPABASE_URL` (the Auth origin), and
`VITE_MUSE_SUPABASE_ANON_KEY` (the anon or publishable key; secret and
service-role keys are rejected). Both origins are pinned in the app's CSP. In
such a build, **Settings → Muse account** signs in or registers with an email
and password. The account is the user's identity on every device. The session is
stored in Keychain (sessionStorage on the web), renewed shortly before it
expires with protection against replaying a rotated refresh token, and revoked
at the provider on sign-out. Other devices stay signed in.

Builds without these values run in single-user local mode: the API key is kept
on the device and no account or service request is made.

## Connect to Ark

Open **Settings → Connect to Ark MA** and enter an existing Ark API key,
optionally specifying its project. A read-only MA request verifies access. In
an account build the key is then stored encrypted in the account by the Open
Muse service and every device signed in to that account reads it from there;
it is kept in memory only, never in device storage. Replacing the key starts a
separate workspace and stops background work tied to the old key; removing it
applies to all of the account's devices. Volcano SSO sign-in is not supported,
and console-only (TOP) actions are not offered.

After an upgrade, a key or Volcano SSO sign-in saved on the device by an earlier
release is kept untouched and never used. In an account build Settings offers to
save that earlier key to the signed-in account or to remove it from the device;
neither happens automatically, and conversations and data from the earlier
setup stay on the device without being attributed to the account.

On first use, Muse prepares an agent and environment automatically. In an
account build the Open Muse service creates the account's agent, environment,
and memory store with the account's key, records them for the account from its
own creation responses, and keeps their IDs and model in the account's sealed
workspace record. The account's other devices read that record instead of
searching Ark, and two accounts sharing one Ark key never receive each other's
resources, even if resource labels are changed outside Open Muse. Resource
labels and every IndexedDB record are scoped by
`accountWorkspaceKey(apiKey, project, owner)`. A holder of the same Ark key can
still reach any resource directly at Ark; use separate keys when accounts must
not reach each other's data. Local builds create and discover resources on the
device, scoped by API-key digest and project. Uncertain creation results are
checked before another write; they are never blindly retried or adopted.

### What an account stores

| Setting | Where it lives | Protection | On another device |
| --- | --- | --- | --- |
| Ark API key and project | Open Muse service, `account_credentials` | AES-GCM, bound to account and revision | Read back after sign-in, kept in memory |
| Agent, environment, and memory-store IDs; agent model | Open Muse service, `account_workspaces` | AES-GCM, bound to account, workspace key, and revision | Read back from the sealed record |
| Background binding (resource IDs plus the key, sealed together) | Open Muse service, `ark_connections` | AES-GCM | Server-side only |
| Schedule (enabled, time zone, time) | Open Muse service, `schedules` | Plain D1 row, account-scoped | Server-side only |
| Agent model, instructions, tools, permission policy, MCP servers, skills; environment settings | The account's Ark agent and environment, plus a sealed copy in `account_workspaces` of what Ark reported after the last change made through Open Muse | Ark; AES-GCM for the sealed copy | Read back from the sealed record; the resources are the same |
| Name, SOUL, MEMORY, goals, and Feed instructions | The account's Ark memory store | Ark | Same memory store |
| Conversation list, saved replies, Library, Feed likes, local approvals | Device IndexedDB, scoped by workspace key | Not app-encrypted | Not synced; conversations themselves remain in Ark |
| Muse session | Keychain (sessionStorage on web) | OS-protected | Each device signs in |
| Appearance (Mac) | Device preference | None | Not synced |

In an account build, changes to the agent or environment — Studio's
`UpdateAgent` and `UpdateEnvironment`, and the app's own policy updates — are
sent to the Open Muse service, which applies them once to the account's own
resource and seals the result with the account. Only one change can be in
flight per workspace. If its result is unconfirmed (a timeout or lost
response), nothing else is changed until the app checks Ark read-only. An
agent still at its earlier version is reported as not applied yet; any other
result Open Muse cannot prove asks the user to review it: Settings shows each
field that differs, saved and in Ark now, and either saves exactly the values
shown or keeps the saved ones; background work pauses as soon as a
review is needed. Keeping the saved settings marks that Ark may differ from
them and keeps background work paused. For the agent, whose versions show a
late change, that ends once a check finds it matching again; an environment has
no version, so it ends only when the user saves Ark's current settings or the
environment is recreated. An agent change is only built on the version Open
Muse saved. Ownership labels cannot be changed
this way. If background work is allowed, it is rebound to the new agent version
and the schedule pauses until it is enabled again. If the agent or environment
is deleted at Ark, preparing the workspace creates it again with the saved
settings; if those settings reference resources an account cannot use, they
are kept and Settings offers an explicit recreation with default settings.
Studio in an account build reaches only the account's own agent, environment,
memory store, and sessions: listings are filtered to them, sessions can be
created only with the account's own agent, environment, and memory store and
without vaults, and resources of these kinds are created only by the service.
Credential vaults and their credentials, uploaded (custom) skills, files, and
TOS buckets are shared by everyone who holds the same Ark key and cannot be
attributed to an account, so an account build refuses them both as Studio
operations and as references: in agent skills (built-in and hub skills remain
available), environment `config.tos`, session-level agent overrides (skills,
`multiagent`), session `vault_ids`, and session resources other than the
account's own memory store. Messages sent from Studio may cite only files this
account uploaded on the same device; files uploaded on another device and
session output files cannot be cited there. Changes made directly at Ark
outside Open Muse are not recorded in the account's sealed settings.

Existing agents retain their model. New agents use the public tool-calling model
`doubao-seed-2-1-pro-260915`; the Ark project must have access to it. Model access
errors remain visible. The inference `/models` endpoint currently has invalid
CORS responses, so neither sign-in nor workspace preparation depends on it.

## Storage and security

- iOS and macOS keep API keys (local builds) and Muse account sessions in
  Keychain. Android encrypts credentials with an Android Keystore-backed
  AES-GCM key and disables backup; Muse accounts are not supported on Android.
- The web app keeps credentials in `sessionStorage`, not persistent local
  storage. A page reload preserves the browser session; signing out clears it.
  Browser extensions or injected scripts can still access browser-held secrets:
  use a trusted host, avoid shared profiles, and revoke compromised keys in Ark.
- Workspace mappings, session metadata, legacy goals, saved replies, and local approval
  records live in IndexedDB. They contain no raw API keys, but conversation
  content is not encrypted by the app. Protect the device/browser profile.
- Saved replies and conversation indexes are device-local. Current goals live
  in personal MA memory; conversations and execution history are read from MA.
- Personal identity documents live in an app-owned MA memory store, scoped to
  the same workspace key as the agent (account owner, API key, and project in
  account builds). Local pending-write records can contain document drafts
  until cloud readback confirms them. These records are not encrypted.
- Signing out of a Muse account ends that session and drops the in-memory key
  and runtime; nothing is deleted. In local builds, signing out removes the
  device's key. Neither revokes the key at Ark; do that in the Ark console.
- Only fixed public Volcano API origins, plus the configured Open Muse service
  and Auth origins, are allowed. Redirects carrying credentials are rejected.
  Production assets include a restrictive CSP; CORS remains enforced rather
  than bypassed.

Upgrading from the backend version requires signing in again. Old `.data/`,
SQLite mappings, and backend credential files are left untouched. Old local
goals and saved replies are not imported automatically; retain those files if
you need their contents. Cloud conversations remain accessible with the same key.

## Native apps

**iOS:** `ios/App/App.xcodeproj`, scheme `App`, bundle ID
`app.openmuse.mobile`. Run `npm run ios` to open Xcode. The app needs only
internet access, not a reachable Mac or service URL. Simulator builds use ad-hoc
signing for Keychain access. Physical-device builds require a local development
identity and provisioning profile; keep team/device identifiers untracked.

**macOS:** the AppKit/WKWebView shell loads bundled assets through `muse://app/`.
The package contains no Node executable or server bundle and opens no listening
port. The build targets macOS 14+ and is not notarized.

**Android:** the Capacitor app uses the same direct client and includes a native
credential-storage plugin. Open with `npm run android`; build the Gradle project
with JDK 21 and SDK 36. See verification notes for platform coverage.

## Conversations

Chat opens a persistent main conversation. A genuinely new connected identity
automatically prepares its MA session and asks MA for a first greeting and name
selection. Existing conversations reuse their active chapter; opening an old
chat does not reset its history or generate another introduction. Side chats
are still created only when their first message is sent.

### First conversation

MA introduces the companion, offers Kit, Milo, and Muse as inline naming
options, and accepts a custom typed name. After a choice, MA updates
`IDENTITY.md` through memory tools and readback, then follows up with a focused
question. The header refreshes from that actual cloud document. Clear lasting
preferences can be saved in personal memory and read by later conversations;
they are not inferred from opening a tab or tapping a category.

The initiation is an app-generated ordinary MA message, not text authored by
the person. A verified local event receipt keeps it out of the normal chat and
conversation export, while the original remains inspectable in execution
history. Assistant text is generated by MA, never synthesized locally. The
welcome is skipped when the identity has prior local conversations, owned
cloud conversations, or customized personal documents. Failed reads never
count as a fresh identity. Model compliance with the requested wording is not
guaranteed.

Same-origin write guards and persisted event IDs prevent duplicate initiations
on rerender or relaunch. Interrupted setup requires an explicit Continue;
uncertain submissions are checked in history, not sent again. These are
device-local guards, not a cross-device atomic first-run protocol. Naming and
follow-up do not establish scheduled check-ins or account access.

When an older main session lacks personal memory, its next message prepares a
memory-enabled continuation. The app preserves the original MA sessions and
shows their messages in the same timeline. Earlier visible turns become a
content-addressed archive in the personal memory store, with known connection
credentials redacted. The new session reads its own archive to retain context;
the archive is not inserted as a fake user message. Old execution records remain
at their original source, including source links for saved replies. Running
tools and sandbox files are not migrated to the new session.

Local write guards serialize continuation and message submission. Interrupted
preparation can resume; an uncertain session-creation result is queried by its
unique marker before any further creation. A message with an uncertain result
also requires history evidence before another main-chat submission.

The sidebar contains the main chat, searchable side chats, archived chats, and
Settings. Start a side chat for a separate topic. Archiving and restoring only
change the local sidebar index; they never delete or terminate a cloud session.
Existing cloud conversations remain accessible as side chats.

Main-chat selection and archive state are device-local and isolated by API key
and project. They are not cross-device preferences. Creation attempts are
recorded before submission and recovered by a random marker after ambiguous
failures, rather than creating another session automatically.

### Inline questions

New conversations can ask a focused question with two to six tappable answers
inside an assistant message. Questions and options come from MA, not preset
replies. Selecting an option sends only its visible label as an ordinary user
message. Typing a different answer remains available. Older questions become
read-only after the conversation moves on.

Selections keep a device-local receipt tied to the exact MA event ID. A checked
option means the message was confirmed, not merely tapped. Before submission,
the app re-reads the question and rejects changed options. Duplicate taps and
uncertain results do not repeat the request; history polling can confirm a lost
response. Receipts survive relaunch on the same device but are not synchronized
across devices. No choice is an implicit tool approval or hidden action.

Only a validated `muse-choice` JSON block can create these controls. Ordinary
Markdown, quoted examples, and HTML do not become interactive commands.
Incomplete or malformed questions leave the message composer available.
Background check-ins require a separately verified scheduling mechanism.

### Check-ins

When the main chat comes to the front after a quiet period, the companion can
start the conversation with one short question about an active goal, a recent
topic, or a stated preference, read from personal memory. It may use an inline
question. A check-in happens only while the app is open, between 08:00 and
22:00 local time, at least 18 hours after the last message, at most once per
local day, and never while a reply is pending or an earlier check-in is
unanswered. A new identity gets the welcome instead.

Like the welcome, the initiation is an app-generated ordinary MA message hidden
from the chat and export by a device-local receipt tied to its exact event ID
and text; it remains in execution history. Claims are transactional per
identity, and an uncertain result is confirmed from history, never sent again.
Each check-in is a real, possibly billed Ark request. Settings has a
device-local toggle under **Check-ins**, on by default. Check-ins do not send
notifications or run in the background.

### Upcoming

Ask the companion for a reminder or a repeating task, such as "every Monday at
9am, remind me to submit my timesheet". MA saves it to `UPCOMING.md` in
personal memory and reads it back before confirming. Items are one-time,
daily, weekly (chosen weekdays), or monthly (a day of the month, clamped to
short months), at a local time in the person's IANA time zone. A time skipped
by a daylight-saving change does not fire that day; a repeated hour fires once.

The companion panel's **Upcoming** tab lists active items soonest first, then
paused ones, with pause, resume, and delete. Each change rewrites
`UPCOMING.md` only if it has not changed since it was read. The companion can
also list, move, pause, or cancel items in chat.

When an item falls due while the main chat is open, including while it stays
open, the app sends one app-generated message and the companion delivers the
reminder or does the task, asking for approval before external actions. Due
reminders take precedence over a check-in. Each occurrence is claimed on the
device before sending and never sent again, even after an ambiguous or
rejected result. Only the latest occurrence from the last 36 hours is
delivered; older misses are not replayed. A device delivers only occurrences
after it first ran this feature, so a new device does not repeat earlier
reminders, but two devices open at the same time can both deliver one. There
are no push notifications or background runs yet.

## Personal identity and memory

Tap the companion avatar to open Activity, Approvals, Desktop, Recent, or
Identity. Identity contains your assistant's name, editable `SOUL.md` persona,
and `MEMORY.md` facts, preferences, and commitments. The name is stored as JSON
text in `IDENTITY.md`; MA memory stores accept `.md` and `.txt` paths only.

Opening Identity is read-only. The first save or new conversation creates an
owned memory store and any missing starting documents. New conversations mount
that store and receive instructions to read it with MA memory tools, preserve
unrelated edits, and verify updates before claiming to remember something.
Persona changes made by the assistant should be announced in the conversation.

The editor compares the latest content with the version opened by the user,
preserves drafts on conflicts, and verifies saves by reading them back. Delayed
readback never triggers a repeated write. MA does not expose an atomic document
compare-and-swap contract, so simultaneous edits from different devices still
require care. Do not put passwords or API keys in personal memory.

Older main conversations attach memory through the history-preserving
continuation described above. An idle main conversation with outdated app
instructions also continues into one linked chapter on the next submission,
without repeating the welcome. The original agent version is pinned; custom
session instructions and older visible turns remain available. This is a new
MA session, not an in-place update or a transfer of sandbox files. Malformed
snapshots, session-specific runtime overrides, extra resource mounts, or bound
Vaults stop automatic continuation rather than discarding configuration. The
original history stays intact and a new side chat remains available.

Older side chats retain their original history
and display a compatibility note; start a new side chat to use personal memory.
There is no scheduled nightly maintenance or interactive remote desktop in this
version.

## Goals

Goals start with Health, Relationships, Finance, Career, Interests, Productivity,
or Something else. The category sheet explains the conversational workflow and
opens an editable draft. Sending it starts a memory-enabled side chat. The
assistant is instructed to clarify the outcome before saving an agreed plan;
selecting a category alone creates no goal.

Confirmed plans and reported progress live in `GOALS.md` in personal MA memory,
as a bounded, validated JSON document. The assistant can read and update the
same records shown in Goals. The app supports plan steps, subgoals, renaming,
completion and reactivation. Completed goals remain accessible through Goals
options. Active goals also inform Feed and Ideas generation.

Existing device-local goals remain intact. An explicit goal action imports
unmigrated records into memory; merely opening Goals is read-only. Cloud records
take precedence for an existing ID. Imported local copies are not resurrected
if a goal is later removed from cloud memory. Older backend SQLite data is not
imported by this process.

Saves check the displayed revision and verify cloud readback. Same-client writes
are queued, and Web Locks coordinate same-origin views when supported. These
checks are not an atomic cross-device lock or a lock against agent-side edits.
Malformed documents remain visible as errors and are never replaced with an
empty plan. Unconfirmed writes are not automatically repeated.

Tracking currently means user-confirmed plans and reported progress, not
scheduled execution. No autonomous check-ins, notification delivery, or external
monitoring are enabled. Completing a goal does not interrupt running tools.

## Capabilities

Feed and Ideas use separate MA conversations to generate personalized posts and
suggestions from personal memory, recent main-chat messages, active goals, and
liked posts. They do not display preset content or task-status cards. Open a
post's information to see why it was suggested and inspect its generation
conversation. Sources are supplied by the assistant and may need verification.

Feed instructions are editable through the top-right control and saved to
`FEED.md` in personal MA memory with conflict checks and readback verification.
Changes affect future posts only. Likes, generated-post indexes, dismissed
instructions, and discussion links are device-local and scoped to the active
connection. Opening Discuss or an idea prepares an editable side-chat draft;
it does not send a message until the user presses Send. Existing discussions
reopen their linked conversation.

Generation runs persist submission markers and recover from real session
history after relaunch. Ambiguous session or message submissions are never
automatically repeated. Invalid output leaves existing content unchanged and
links to the generation conversation. Generation is user-triggered; no periodic
background delivery, push notifications, or autonomous scheduling is enabled.

Conversations support streamed events, history backfill, interruption, tool
approvals, Markdown export, goals, and saving real replies with source links.
MA Studio retains 52 operations covering agents, environments, sessions, memory,
connections, skills, and files. Studio writes require confirmation; deletion
requires checking the target ID. See [MA coverage](docs/ma-coverage.md).

App-managed agents default to `always_allow` tool permissions. Tools can send
data, perform writes/deletions, and incur charges. Explicit upstream denials
remain in force. For pending approvals in older sessions, only exact
`web_search` and `web_fetch` tool names are auto-approved, with local audit
records and protection against duplicate submissions.

Cloud setup includes Chrome, a small CDP driver, and Lark CLI/skills. See
[environment toolbox](docs/environment-toolbox.md). No cloud setup commands run
on the phone, browser, or Mac itself.

## Development

```text
src/                  UI and the direct, device-local application runtime
shared/               Ark/OAuth adapters, signing, API catalog, tool payloads
ios/                  iOS shell and UI tests
macos/                Serverless macOS shell
android/              Android shell and Keystore plugin
tests/                Direct-client, protocol, UI, and migration tests
tests/legacy-server/  Test-only migration harness; never shipped or started
scripts/              Builds and asset generation
.build/               Ignored local builds and test artifacts
```

See [verification](docs/verification.md), [contribution conventions](CONTRIBUTING.md),
and [third-party notices](THIRD_PARTY_NOTICES.md).
