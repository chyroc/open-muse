# How it works

The detailed behavior of each part of Open Muse: accounts and credentials,
storage, conversations, memory, goals, reminders, and generated content. For
building and running the apps, see [Development](development.md).

## Overview

A personal AI task assistant built on a Managed Agents (MA) service, Volcano Ark
by default. The web, iOS, Android, and macOS apps connect directly to the MA
API. No Open Muse backend, local API service, app access token, or server URL
is required. Claude Managed Agents can replace Ark at build time; see
[Built on Managed Agents](../README.md#built-on-managed-agents).

Conversations use real MA responses. Without an Ark connection the app stays
signed out; network failures never produce simulated replies. Cloud calls and
cloud environments may incur charges.

Current feature development and acceptance focus on iOS. The other platform
projects are retained; shared-client changes do not establish platform-specific
verification. See [verification coverage](verification.md) for limitations.

## Open Muse accounts

Release builds set three public values at build time: `VITE_MUSE_BACKGROUND_URL`
(the Open Muse service origin), `VITE_MUSE_SUPABASE_URL` (the Auth origin), and
`VITE_MUSE_SUPABASE_ANON_KEY` (the anon or publishable key; secret and
service-role keys are rejected). Both origins are pinned in the app's CSP. In
such a build, **Settings → Open Muse account** signs in or registers with an email
and password. The account is the user's identity on every device. The session is
stored in Keychain (sessionStorage on the web), renewed shortly before it
expires with protection against replaying a rotated refresh token, and revoked
at the provider on sign-out. Other devices stay signed in. There is no password
reset in the app. **Delete account** in the same card removes
the account, everything the Open Muse service keeps for it, and its sign-in;
conversations, memory, and the agent stay in the person's Ark account.
**Export my data** saves a JSON copy of everything the service keeps for the
account, with the Ark API key shown only by its last four characters.

Builds without these values run in single-user local mode: the API key is kept
on the device and no account or service request is made.

## Connect to Ark

Open **Settings → Connect to Ark MA** and enter an existing Ark API key; the
key's own project is used. A read-only MA request verifies access. In an
account build the key is then stored encrypted in the account by the Open Muse
service and every device signed in to that account reads it from there; it is
kept in memory only, never in device storage. Replacing the key starts a
separate workspace and stops background work tied to the old key; removing it
applies to all of the account's devices. Volcano SSO sign-in is not supported,
and console-only (TOP) actions are not offered.

After an upgrade, a Volcano SSO sign-in saved on the device by an earlier
release is kept untouched and never used. An account build likewise leaves an
API key saved on the device by a local build untouched and never uses or
uploads it; conversations and data from that setup stay on the device without
being attributed to the account.

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
| Chosen model and thinking level, saved replies, Feed and Ideas posts with likes and discussion links, Feed instructions dismissal, archived side chats, the main chat and its earlier chapters | Device IndexedDB, scoped by workspace key, plus a synced copy in `account_sync_items` | Not app-encrypted on the device; AES-GCM on the service, bound to account, workspace key, item, and revision | Synced for the same workspace key (see [Sync across devices](#sync-across-devices)) |
| Side-chat list, in-progress main-chat continuation, local approvals, reactions | Device IndexedDB, scoped by workspace key | Not app-encrypted | Not synced; conversations themselves remain in Ark |
| Lark sign-in (lark-cli configuration and token store) | The conversation's cloud environment, plus a saved copy in `lark_states` (account builds) | AES-GCM on the service, bound to the account | Restored in each new conversation's cloud environment; Disconnect in Connectors removes it |
| Open Muse session | Keychain (sessionStorage on web) | OS-protected | Each device signs in |
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

### Sync across devices

In an account build, the account's devices keep these in step for the same
workspace key: the chosen model and thinking level, saved replies (one item
per original session and event, so saving the same reply on two devices keeps
one), Feed and Ideas posts with their likes and discussion links, the Feed
instructions dismissal, which side chats are archived, and the main chat with
its earlier chapters. The side-chat list, reactions, approvals, check-in and
reminder receipts, and pending generation runs are not synced. Local builds
never upload any of it.

Every device of the account opens the same main chat. A device without one
syncs before starting a main chat and opens the account's instead; a device
that had its own keeps it as a side chat. When one device continues the main
chat into a new chapter, the others follow it and earlier chapters still lead
to it. A new chapter that a device has already started creating finishes
first and then becomes the account's main chat; if two devices continue at the
same time, the chapter created last wins and the other stays as a side chat.

Each device keeps its records in IndexedDB as before and syncs when the app
starts, when it returns to the foreground (at most every two minutes), and a
couple of seconds after a change: it first reads what changed since its last
cursor, then sends its own changes. Every change waits in an outbox kept under
the workspace key, with a stable mutation ID, until the service confirms it, so
an interrupted send is repeated with the same ID and written once. The
workspace key includes the signed-in account, so signing out or switching
accounts never sends the previous account's pending changes. Records saved
under the account's workspace before sync existed already belong to that
account and are uploaded on the first sync; records from a local build or
another account are not.

The service writes an item only at the revision the device last saw. When
another device changed it first, the device merges the two field by field
against the copy it last synced: a field changed only on this device is kept
and sent again on top of the other device's copy; a field changed on both sides
takes the copy already on the service. For example, a like on one device and a
discussion link on another both survive, while two different model choices end
with the one saved first. Deleting an item leaves a tombstone so an outdated
device cannot bring it back. A saved reply over 20,000 characters, or any item
the service refuses, stays only on the device where it was made. A model the
app does not offer, chosen on a newer version, is kept on the service and left
alone locally. Screens show synced changes the next time they read their data;
the chat list and main chat update as soon as a change arrives.

## Storage and security

- iOS and macOS keep API keys (local builds) and Open Muse account sessions in
  Keychain. Android encrypts credentials with an Android Keystore-backed
  AES-GCM key and disables backup; Open Muse accounts are not supported on Android.
- The web app keeps credentials in `sessionStorage`, not persistent local
  storage. A page reload preserves the browser session; signing out clears it.
  Browser extensions or injected scripts can still access browser-held secrets:
  use a trusted host, avoid shared profiles, and revoke compromised keys in Ark.
- Workspace mappings, session metadata, legacy goals, saved replies, and local approval
  records live in IndexedDB. They contain no raw API keys, but conversation
  content is not encrypted by the app. Protect the device/browser profile.
- Conversation indexes are device-local; saved replies sync in account builds
  (see [Sync across devices](#sync-across-devices)). Current goals live in
  personal MA memory; conversations and execution history are read from MA.
- Personal identity documents live in an app-owned MA memory store, scoped to
  the same workspace key as the agent (account owner, API key, and project in
  account builds). Local pending-write records can contain document drafts
  until cloud readback confirms them. These records are not encrypted.
- Signing out of an Open Muse account ends that session and drops the in-memory key
  and runtime; nothing is deleted. In local builds, signing out removes the
  device's key. Neither revokes the key at Ark; do that in the Ark console.
- **Reset this device** (iOS Settings, macOS Settings > Data controls) asks for
  confirmation, then removes the saved API key and every sign-in from
  Keychain, deletes all local databases and preferences, and restarts the app
  as if newly installed. Agents, conversations, memory, and the Open Muse account in
  the cloud are not deleted, and the key is not revoked at Ark.
- Only fixed public Volcano API origins, plus the configured Open Muse service
  and Auth origins, are allowed. Redirects carrying credentials are rejected.
  Production assets include a restrictive CSP; CORS remains enforced rather
  than bypassed.

Upgrading from the backend version requires signing in again. Old `.data/`,
SQLite mappings, and backend credential files are left untouched. Old local
goals and saved replies are not imported automatically; retain those files if
you need their contents. Cloud conversations remain accessible with the same key.

## App behavior

**Language:** the apps follow the device's preferred languages, using the
first English or Chinese entry and English otherwise. iOS Settings > Language
can pin English or 简体中文 on this device; Follow system removes the choice.
The choice restarts the app, is not synced, and is cleared by a device reset.
Native system sheets, such as permission prompts, follow the system language.

**Appearance (iOS):** the app follows the system light or dark appearance. Text
keeps its size at the everyday system text sizes and grows at the larger
accessibility sizes (Dynamic Type). Settings opens as a sheet over the current
page. Feed, Ideas, Goals, and Library refresh when pulled down from the top.
Long-pressing a message offers a quick emoji reaction (more in a searchable
sheet), Reply (quotes it into the composer), Copy, Select, Share, and for the
assistant's replies, Save to Library. Reactions are kept on the device for the
signed-in identity and are not sent to Ark. Library shows a list or a grid,
ordered by last modified or by title, from its header menu. The plus button in
the composer adds a photo from the camera or library, a document (PDF, text,
Markdown, or CSV) from Files, or a video, which is attached as up to four
evenly spaced still frames; the video itself never leaves the device. A
video shows as one attachment. Sent photos and videos appear as thumbnails that
open full screen, from copies kept on the sending device (up to 300 MB, oldest
dropped first; videos over 100 MB keep only their frames), because Ark offers
no way to download uploads back. Other devices show a placeholder.

**Model:** Settings > Model chooses the model and thinking depth for new
conversations, per account: Doubao Seed 2.1 Pro (the default), Lite and
Turbo, DeepSeek V4 Pro and V4.1 Flash, or GLM-5.3 Flash, each with the
thinking levels it accepts. The Doubao models and DeepSeek V4.1 Flash read
images; the others are text only. A conversation keeps the model it was
created with, so the main chat moves to a new chapter, with its history kept,
the next time it is opened after a change. Feed and Ideas keep the default.

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

Main-chat selection is isolated by API key and project. In an account build,
the main chat and its chapters are shared by the account's devices, and
archiving or restoring a side chat syncs to them; the main chat and its earlier
chapters never take an archive state from another device. In a local build the
main chat belongs to the device. Creation attempts are
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

### Check-ins

When the main chat comes to the front after a quiet period, the companion can
start the conversation with one short question about an active goal, a recent
topic, or a stated preference, read from personal memory. It may use an inline
question. A check-in from the app happens only while it is open, between 08:00 and
22:00 local time, at least 18 hours after the last message, at most once per
local day, and never while a reply, approval, or tool result is pending or
while a welcome, check-in, or reminder from any device is unanswered. A new
identity gets the welcome instead.

The initiation is an app-generated ordinary MA message. It is hidden from the
chat and export by its exact event ID and text, and on other devices by its
fixed app-written opening; it remains in execution history. Claims are transactional per
identity, and an uncertain result is confirmed from history, never sent again.
Each check-in is a real, possibly billed Ark request. Settings has a
device-local toggle under **Check-ins**, on by default. Check-ins do not send
notifications.

With an Open Muse account, the app first claims the day's check-in (its local
date) with the Open Muse service, and only the device or service that claims
it first sends it. When the claim is lost, nothing is sent and the day is not
asked about again; when the service cannot be reached, nothing is sent and the
claim is tried the next time. Local mode has no claim.

Once delivery while closed is on in Upcoming, **Check-ins** also offers **Check
in even when Open Muse is closed**, an account setting that is off by default.
The service then checks in on the registered main chat while every app is
closed, with the same rules in the time zone the app last registered, and
counts toward the same once-per-day limit (see
[the service README](../server/README.md#check-ins-and-goal-follow-ups-while-closed)).
It uses the account's saved Ark key; each check-in is a real, possibly billed
Ark request.

### Upcoming

Ask the companion for a reminder or a repeating task, such as "every Monday at
9am, remind me to submit my timesheet". MA saves it to `UPCOMING.md` in
personal memory and reads it back before confirming. Items are one-time,
daily, weekly (chosen weekdays), or monthly (a day of the month, clamped to
short months), at a local time in the person's IANA time zone. A time skipped
by a daylight-saving change does not fire that day; a repeated hour fires once.

The companion panel's **Upcoming** tab groups items by how often they repeat
(daily, weekly, monthly, one time), soonest first within a group and paused
ones last, with pause, resume, and delete. Each change rewrites
`UPCOMING.md` only if it has not changed since it was read. The companion can
also list, move, pause, or cancel items in chat.

When an item falls due while the main chat is open, including while it stays
open, the app sends one app-generated message (hidden like a check-in) and the
companion delivers the reminder or does the task, asking for approval before
external actions. A conversation waiting on an approval or tool result is not
interrupted; the reminder follows once it is free. At most five items go in one
message, and the rest follow. Due reminders take precedence over a check-in. Each occurrence is claimed on the
device before sending and never sent again, even after an ambiguous or
rejected result. Only the latest occurrence from the last 36 hours is
delivered; older misses are not replayed. A device delivers only occurrences
after it first ran this feature, so a new device does not repeat earlier
reminders. Before sending, it also skips occurrences another device already
delivered to the main chat. In local mode, two devices sending in the same
moment can still both deliver one; with an Open Muse account, each device
claims every occurrence with the service first and delivers only the ones it
won. An occurrence another device or the service claimed is left to it; when
the service cannot be reached, the occurrence stays due and nothing is sent
for it until a claim succeeds. Resuming or changing an item does not replay
occurrences that passed in the meantime.

With an Open Muse account, **Deliver even when Open Muse is closed** in the Upcoming
tab registers the main chat with the Open Muse service, which then delivers due
items with the account's saved Ark key while the apps are closed (see
[the service README](../server/README.md#upcoming-reminders)). It is off by
default. While the service delivers to the current main chat, the apps do not
deliver locally; when the main chat continues into a new chapter, the app
registers the new conversation. If the service cannot be reached, the app keeps
its last known answer instead of starting to deliver itself.

On iPhone, Open Muse also hands the next week of active items (up to 48) to
the system as local notifications, so a due item is announced even while the
app is closed. The list is replaced on launch, after each change in the
conversation, when the app goes to the background, and after a change in the
Upcoming tab; signing out clears it. Notifications are requested the first
time there is something to announce and are not shown while the app is in
front, where the main chat delivers the item itself. There are no remote push
notifications, and the Mac and web apps show no notifications.

### Incoming webhooks

With an Open Muse account, the **Webhooks** card in Settings > Account and
workspace on iPhone creates webhook
URLs that other services can post events to: a Lark (Feishu) event
subscription, a script, or IFTTT. Each event becomes one hidden
app-generated message in the main chat, and the companion tells you what
happened when it matters, using its normal tools and asking before external
actions. Creating a hook shows its address and secret once, plus the address
with the secret as a `token` parameter for services that cannot set headers;
the list shows each hook's last event, and revoking one (after confirming)
stops it at once. Events are accepted only while background work is allowed
(on by default) and **Deliver even when Open Muse is closed** is
on in Upcoming; a busy chat refuses an event so the sender can retry. Event
contents are treated as untrusted third-party data, never as your request.
Anyone with a hook's address and secret can post into your main chat, so
revoke a hook whose address leaked. See
[the service README](../server/README.md#incoming-webhooks) for limits and the
security details.

### Lark message channel

Settings > **Message channels** on iPhone connects Lark (Feishu), so the
person can message their assistant from Lark. Connecting creates an incoming
webhook named "Lark message channel" and shows its address once, with the
steps for the Lark developer console: turn on the bot of the app the
assistant uses with lark-cli, send its receive-message events
(`im.message.receive_v1`) to the address without an encrypt key, and publish
it; **Ask my assistant to set it up** drafts that request in the main chat.
A message to the bot reaches the main chat as a hidden app-generated message
with its sender, chat, and text. The companion first confirms with lark-cli
that the sender is the person's own Lark account; only then does it treat the
text as the person's request and answer in Lark as the bot, replying to that
message, and here. A message from anyone else is never followed or answered
in Lark; the companion only mentions it in the app. The assistant reads only
messages sent to the bot. **Get a new address** replaces the address, and
**Disconnect Lark** revokes the hook at once. The same delivery conditions
and limits as other webhooks apply.

### Devices and About

Settings > **Devices** on iPhone lists this iPhone and the account's other
devices with when each was last seen and the build it runs; removing one only
takes it off the list. **About** shows the commit the app was built from as
its version (with "-modified" when the build had uncommitted changes); tap it
to copy. The Mac shows the same version in Settings > General and in the
About Open Muse window.

### Data on your iPhone

The iPhone app answers two device tools. `health_read` reads one Apple Health
metric over a time range; once the person connects Apple Health (from the
first request or Connectors), reads are answered without asking each time,
and **Disconnect** in Connectors returns to asking. `iphone_personal` reads
calendar events (a range of up to 92 days), open reminders, or contacts
matching a name, phone number, or email. It only reads, and every call shows
a card in the chat naming what it reads; nothing is read until the person
taps **Share**, and **Don't share** tells the companion not to try another
way. Calendar, Reminders, and Contacts are listed in Connectors: connecting
one explains it in a sheet and then asks iOS for access, and iOS Settings >
Open Muse changes that access. Both tools wait while the iPhone app is
closed; the Mac and web apps say they are waiting for the iPhone.

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
without repeating the welcome. The original agent version is pinned, except
that a chat whose agent version lacks a device tool the app now answers (such
as `iphone_personal`) continues on the current version; then only the app's
device tools may differ, and any other change to tools, model, MCP servers,
or skills still stops the continuation. Custom session instructions and older
visible turns remain available. This is a new
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
scheduled execution. Notification delivery and external monitoring are not
enabled. Completing a goal does not interrupt running tools.

With an Open Muse account and delivery while closed on, **Follow up on goals**
under **Check-ins** (off by default) lets the service ask about a stalled goal.
When an active goal in `GOALS.md` has had no update for seven days, the service
sends one app-generated message to the main chat naming the goal that has gone
longest without one, opening with `<open-muse-goal>` (`shared/goal-followup.ts`).
It asks the companion to reread `GOALS.md` and ask one short question about
that goal, and to update progress only from what the person reports. The apps
hide it like a check-in. It follows the same quiet hours and pending-state
rules as check-ins, takes the place of that day's check-in, happens at most
once per account every three days and for the same goal at most weekly, and
is claimed like other app-generated messages, never resent. Each follow-up is
a real, possibly billed Ark request.

## Capabilities

Feed and Ideas use separate MA conversations to generate personalized posts and
suggestions from personal memory, recent main-chat messages, active goals, and
liked posts. They do not display preset content or task-status cards. Open a
post's information to see why it was suggested and inspect its generation
conversation. Sources are supplied by the assistant and may need verification.

Feed instructions are editable through the top-right control and saved to
`FEED.md` in personal MA memory with conflict checks and readback verification.
Changes affect future posts only. Likes, generated-post indexes, dismissed
instructions, and discussion links are scoped to the active connection. In
account builds they sync across the account's devices (see
[Sync across devices](#sync-across-devices)); in local builds they stay on the
device. Opening Discuss or an idea prepares an editable side-chat draft;
it does not send a message until the user presses Send. Existing discussions
reopen their linked conversation.

Generation runs persist submission markers and recover from real session
history after relaunch. Ambiguous session or message submissions are never
automatically repeated. Invalid output leaves existing content unchanged and
links to the generation conversation. Generation on the device is
user-triggered; push notifications are not enabled.

In account builds, background work is on by default: once the account's Ark
key and workspace are ready, the iPhone and Mac apps let the Open Muse service
use them and keep a daily Feed scheduled (08:00 in the device's time zone
unless one was already set). They check at launch, on returning to the
foreground, and at most hourly; each write is sent once and a failure waits
for the next check. Removing the Ark key from the account stops it. Posts the
service prepares also appear in the Feed, on iPhone and Mac. They
are merged with the device's posts newest first; a post the device already
shows from the same MA reply appears once. The device's cached copy shows at
once and offline, and the page never waits for the service. These posts have
no like, and Discuss opens a new side-chat draft each time (on Mac, quotes the
post in the chat) instead of reopening a linked discussion, because likes and
discussion links belong to the device's own posts.

Conversations support streamed events, history backfill, interruption, tool
approvals, Markdown export, goals, and saving real replies with source links.
MA Studio retains 52 operations covering agents, environments, sessions, memory,
connections, skills, and files. Studio writes require confirmation; deletion
requires checking the target ID. See [MA coverage](ma-coverage.md).

App-managed agents default to `always_allow` tool permissions. Tools can send
data, perform writes/deletions, and incur charges. Explicit upstream denials
remain in force. For pending approvals in older sessions, only exact
`web_search` and `web_fetch` tool names are auto-approved, with local audit
records and protection against duplicate submissions.

Cloud setup includes Chrome, a small CDP driver, and Lark CLI/skills. See
[environment toolbox](environment-toolbox.md). No cloud setup commands run
on the phone, browser, or Mac itself.
