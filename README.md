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
Do not place credentials in build-time environment variables or source files.

## Connect to Ark

Open **Settings → Connect to Ark MA**, then choose either:

- **Volcano SSO:** authorize on the Volcano website, paste the authorization
  code or callback, select a project, and connect. OAuth PKCE and STS request
  signing happen on this device. The app creates a dedicated key with access to
  the project's Ark resources and no source-IP restriction. The authorization
  transaction expires after ten minutes and is single-use.
- **API Key:** enter an existing key, optionally specifying its project. A
  read-only MA request verifies access before the key is saved. Control-plane
  operations requiring STS still require SSO.

On first use, Muse prepares an agent and environment automatically. Their
mapping is stored in IndexedDB, isolated by API-key digest and project. Reusing
the same connection recovers app-owned cloud resources by ownership metadata,
including resources created by the earlier server-backed version. Uncertain
creation results are checked before another write; they are never blindly retried.

Existing agents retain their model. New agents use the public tool-calling model
`doubao-seed-2-1-pro-260915`; the Ark project must have access to it. Model access
errors remain visible. The inference `/models` endpoint currently has invalid
CORS responses, so neither sign-in nor workspace preparation depends on it.

## Storage and security

- iOS and macOS keep API keys and SSO credentials in Keychain. Android encrypts
  credentials with an Android Keystore-backed AES-GCM key and disables backup.
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
  the API key and project. Local pending-write records can contain document
  drafts until cloud readback confirms them. These records are not encrypted.
- Signing out removes local credentials, not cloud resources or keys. Revoke
  keys in the Ark console when needed. Sign out before switching accounts.
- Only fixed public Volcano API origins are allowed. Redirects carrying
  credentials are rejected. Production assets include a restrictive CSP; CORS
  remains enforced rather than bypassed.

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
