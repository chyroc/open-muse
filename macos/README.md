# Open Muse for macOS

The Mac app uses AppKit and a dedicated bundled WebView workspace. It does not
load the mobile UI, host a web server, or depend on Node at runtime. It reuses the
direct MA client and its identity-scoped storage, streaming recovery, conversation
continuation, and approval policy. Credentials remain in the existing Mac Keychain
service; existing IndexedDB data stays at the same `muse://app` origin.

## Build and check

```sh
npm ci --prefix macos
node scripts/build-macos.mjs
npx vitest run --config macos/vitest.config.ts
```

The signed local app is `.build/macos/Open Muse.app`. The build type-checks
`macos/tsconfig.json`, builds only `macos/ui`, and compiles the native host.
`npm run macos:build` also runs the repository's shared web build before the
Mac-specific build. No iOS or Android build is needed.

## Desktop workspace

- A 74-point navigation rail, continuous main chat, searchable side-chat drawer,
  assistant activity/approval panel, and a bottom-aligned message composer.
- Return sends; Shift-Return inserts a newline; IME composition does not submit.
- Command-N opens a side-chat draft; Command-K searches conversations;
  Command-comma opens settings; Command-1 returns to the main chat.
- Opening or searching a chat does not create a cloud session. The first explicit
  send prepares the MA workspace; unconfirmed writes are not automatically retried.
- Closing the window keeps the app running; clicking its Dock icon restores it.
- Both windows render before the Keychain login is restored. A pending or denied
  authorization leaves the app usable and disconnected, reports the refusal with
  a retry, and never writes to secure storage, so the saved credential survives.

This is an incremental desktop implementation, not a verified one-to-one clone.
Cloud artifact/media indexing, attachments, dictation, desktop
automation, and proactive scheduling still need their Mac-specific implementation
and acceptance checks. The UI identifies unfinished surfaces. No mock replies are
included in the app. Real cloud verification requires an authorized connection.

## Settings window

Command-comma, the rail's settings button and every "connect" action open a
separate 800 × 600 window with a 225-point section list. The window only closes;
it does not resize or zoom, and closing it leaves the workspace untouched. Both
windows share one connection: a sign-in or sign-out in either refreshes the other
through the native credential bridge, and native callbacks answer the window that
asked for them.

General opens with grouped rows: connection status, sign-in method and project,
then the resolved interface language with the rule that the app follows the
system list and stores no override, then the bundle version. The shared sign-in
panel stays collapsed behind a "manage connection" row instead of pushing those
groups out of view; the end of the about group still needs scrolling. Secure
storage describes where credentials actually live. Permissions reports, without changing anything, that the
provisioned agent toolset is set to always-allow so MA runs those tools directly;
that MA still sends a request for whatever its own policy evaluates as ask; that
this client auto-approves only pending `web_search`/`web_fetch` by exact protocol
name; that every other pending request waits in the conversation; and that writes
are never retried. Data controls inventories local and cloud records. Both
sign-out paths — the sidebar entry and the shared panel's own button — stop at
the same confirmation, and neither revokes the cloud key.

Appearance is a real three-way choice: light, dark, or follow macOS. It is a
device-local presentation preference with no credential, cloud record or identity
scope, it is applied to both windows at once, and the shell matches the window
chrome and native dialogs to it. Choosing "system" keeps following macOS as it
changes; choosing light or dark stops following it. Accent themes, the startup,
menu-bar and floating-button switches, the shortcut recorder, usage and update
checks remain pending Mac features, not dropped ones, and connectors, computer
use, file system access, dictation, wallet, message channels, devices, help and
legal keep their place in the list and explain why they are not connected. None
of them render a control that does nothing.

The section list matches the reference, including the three names the reference
leaves in English inside a Chinese interface. They are ordinary catalog entries
whose Simplified Chinese value is the same English text, so the shared
localization mechanism and the system-language rule are unchanged. The account,
usage and language panes are replaced by facts this client can prove instead of
an account portal, a quota meter and a 47-language picker it has no data or
override for.

## Appearance tokens

Every Mac stylesheet draws from one token set in `ui/theme.css`, with a light and
a dark value for each token. The values follow the reference desktop app's own
token scale: its surfaces, dividers, text
alphas and destructive colors, not an invented palette. Illustration colors, such
as the avatar and the identity-file cards, are brand art and stay fixed in both
appearances. The reference's own dark rendering has not been observed, so
matching its dark screens is unverified; only its token values are used.

## Desktop Library

Library has a 240-point category sidebar, search, grid/list layouts, pinning,
last-opened/created/title sorting, selection and bulk removal. Saved replies are
actual MA text documents with source-session/event provenance, not executable
artifacts or generated media. Automatic sorting groups pinned, recently opened,
and remaining documents without duplicates. Search matches original titles and
text; opening content never sends a message. Pinning, recents and view preferences
are account/project-scoped on this Mac and do not sync between devices. Selection
replaces the header with a selected-count title, a destructive removal action, a
select-all action and an exit control, instead of adding a second toolbar.

A document opens in a desktop reading surface with a 60-point title bar. Its menu
opens the source conversation, exports the original Markdown through macOS's
Save dialog, or removes the saved copy from this Mac. Removal requires confirmation,
preserves the cloud conversation, and offers Undo while Library remains open.
Undo merges concurrent saves; removal only deletes the exact reviewed record.
Native exports clean up callbacks on completion, timeout or workspace unmount.
PDF/binary exports and public sharing are not claimed by the text-only bridge.

Create only seeds an unsent composer draft. Chat opens to the left of Library;
the compact title menu retains category navigation and search when the sidebar
is hidden. An existing draft requires an explicit replacement choice. Creating
does not create a session, send, upload, or manufacture an artifact. SOUL.md,
MEMORY.md and IDENTITY.md link to the existing revision-safe editor under System
files, explicitly identified as MA memory documents rather than a sandbox tree.

Web artifacts, cloud media, podcasts, and sandbox filesystem browsing remain
unconnected in this adapter. Their category surfaces explain the limitation.
Podcast creation is absent rather than simulated: it needs a scheduled series,
which no connected capability provides. Searching replaces the category surface,
so list controls stay hidden until the query is cleared.
No proprietary reference artwork, account content or test fixtures are shipped.
Isolated tests cover populated rendering, safe local removal/recovery, the native
text-export contract, both languages and the system-language fallback. Native
acceptance is read-only and does not imply real-cloud creation acceptance.

## Identity and memory editing

The right panel uses the desktop Activity, Approvals, Upcoming and Identity tabs.
Identity opens SOUL and MEMORY cards with their cloud modification dates. A document
opens in a full-width desktop editor with a 720-point text column, formatting
toolbar, Markdown source mode, and Command-S. Saves use the existing MA revision
checks and read-back verification; failures and conflicts retain the draft. Closing
a changed document asks before discarding it. Reviewing the latest cloud copy does
not replace the draft until explicitly chosen. Account switching is blocked while
a document is open so drafts cannot cross connections.

The rich-text editor uses MIT-licensed Tiptap/ProseMirror.
Mac-only dependencies are isolated in `macos/package.json` and its lockfile.
Their license texts are bundled in the app's `Contents/Resources/Editor-LICENSES.txt`.
Unsupported Markdown constructs stay in source mode to avoid losing data. `IDENTITY.md` currently
uses the shared MA client's name-only JSON schema, so additional character,
vibe and emoji fields are not yet supported. Upcoming tasks remain explicitly
unavailable until a real background scheduler is implemented.

## Desktop feed

The feed uses a centered 640-point content column, date/time-of-day editions,
emoji markers, Markdown posts, source links, love reactions, explanation dialogs,
and a desktop instructions modal. Discuss quotes a post in the main chat beside
the feed; it does not create a session or send anything until the user sends a
message. Closing the chat panel preserves its draft and quote.

Generation uses the shared direct MA client, including its uncertain-write guards
and exact-name read-only web-tool approval policy. Opening or refreshing the feed
only reads existing content. Generate explicitly starts or resumes an MA request.
Background editions, image/media attachments, and rich widgets are not implemented.

Instructions are revision-checked in MA memory. Command-S saves; errors retain the
draft; reviewing a conflicting cloud copy does not overwrite it. Unsaved instructions
also participate in the native window-close guard. Navigation/account changes are
blocked until the editor closes.

Post ordering and removal are a Mac-only, account/project-scoped IndexedDB overlay.
Move up/down/to-top stay within an edition. Delete asks for confirmation and offers
Undo; the source MA conversation is never deleted. Likes and generated posts use
the shared client's local index. These presentation changes do not sync between
devices. No stock posts are shipped.

## Desktop ideas

Ideas uses a 768-point reading column, four featured list rows, category sections,
and a desktop preview with a blue action button. The preview shows the description,
personal relevance, sources, and MA-generated "What's included" / "How it works"
details. Optional deliverables can be deselected; essential ones remain included.
Older shared-client ideas remain visible without invented preview details.

Opening a row or the feedback menu only reads. "Let's do it" explicitly starts a
main-chat request and reveals chat alongside Ideas. The request asks MA to clarify
missing information and preserve approval for consequential actions. A confirmed
request becomes "Open conversation"; it is not presented as an installed artifact.
Failed or unconfirmed requests remain inspectable, and preparing requests can be
continued explicitly. Exact request text (including a unique correlation ID) is
reconciled against cloud history after a lost response; unconfirmed sends are not
repeated after refresh or restart.

"More like this" saves a preference. "Not interested" dismisses the row, offers
Undo, and allows a preset reason or a custom note of up to 600 characters. Notes
participate in native unsaved-close protection and block navigation/account changes
until closed. Feedback, dismissals, preview metadata, and activation records are
account/project-scoped on this Mac. Preferences are supplied to subsequent Mac MA
generation; they do not synchronize to other devices or modify source cloud events.

The Mac-only generator reuses the shared client's workspace, personal memory,
history, goals, direct MA transport and the existing resumable generation state
machine. It validates a Mac preview extension before indexing content. Invalid
responses leave earlier ideas unchanged. Generation is explicit; automatic idea
delivery, reference artwork, and installation of scheduled tasks/apps are not yet
implemented. Test fixtures are excluded from the production entry point.

Automated checks cover preview selection, feedback, account isolation, generation
validation, split chat, and lost-create/send recovery. Native acceptance covers the
connected empty state and read-only split-chat navigation. Populated rendering and
write behavior are tested with isolated fixtures, not claimed as real-cloud
end-to-end acceptance.

## Desktop goals

Goals uses a 768-point reading column, category rows, expandable goal trees, and
centered desktop dialogs. Normal categories open a 420-point introduction dialog;
"Let's do it" explicitly creates a dedicated MA conversation and sends the category
starter beside Goals. "Something else" confirms the introduction then fills the
main-chat composer without creating or sending. Add subgoal also prepares a draft.
An existing composer draft requires a replacement choice. Goal drafts prepare MA
goal memory only on explicit Send. Existing goal conversations can be reopened.

The cloud GOALS.md document remains authoritative. Completing a parent completes
its descendants; reactivating a child reactivates its ancestors. Rename, plan-step
updates and subtree deletion are revision-checked and verified by readback. Legacy
records are imported only on explicit actions. Whole-document transitions use the
shared same-origin goals lock after preparation. This is not a cross-device lock;
cloud revision/content checks and the shared pending-write guard still apply.

The 600-point goal detail shows saved descriptions, steps, subgoals, and a bounded
local journal of changes actually observed on this Mac. Deleted goals are removed
from that journal. The options menu controls subtitles and opens completed goals.
Rename drafts survive errors and conflicts; adopting a new revision or replacing
the draft requires an explicit choice. They participate in the native unsaved-close
guard and block workspace/account switching.

Dedicated conversation creation and its starter event are durably guarded. Lost
creates require an exact unique session-title match; lost sends require both the
stable event ID and exact text in cloud history. Refresh does not repeat writes.
Recovery can open a confirmed conversation without creating another. Friendly chat
labels are stored locally; cloud recovery titles retain their unique tokens.

Goal deletion removes the goal and descendants from personal memory, not their
cloud conversations. Completing a goal does not cancel running tools. Automatic
monitoring, a suggestions/artifact timeline, and a tracking
schema are not implemented by this adapter; no tracking section or invented
activity is displayed. Local subtitles, journal and chat labels do not sync across
devices. Automated acceptance uses isolated fixtures excluded from the app;
native acceptance covers the empty page, introduction and unsent split-chat drafts.
It also covers the completed-goals list and the 600-point detail dialog by reading
an existing synthetic cloud acceptance goal; no goal or conversation was created,
sent, renamed, completed, or deleted during that native check. English, Simplified
Chinese and unsupported-language fallback are tested without translating personal
goal titles, descriptions or steps. Chat labels follow the current app language.

Goals is lazy-loaded independently. If its native bundle chunk becomes unavailable,
the workspace retains navigation and offers an explicit reload instead of taking
down the whole window. This recovery does not retry any cloud write.
