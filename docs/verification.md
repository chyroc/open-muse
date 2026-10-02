# Verification record

Verification date: 2026-09-30. Mocked-upstream regression tests are distinguished from real cloud tests. No personal credentials, accounts, resource IDs, or raw logs are included.

Current acceptance focuses on iOS. The web and macOS results below record earlier direct-client verification, not acceptance of the latest companion, Feed, or Ideas interfaces on those platforms.

## Automated checks

- TypeScript checks pass; 25 test files and 452 tests pass, including 89 direct-client cases.
- Conversation coverage includes lazy main-session creation, restart recovery, independent side chats, identity isolation, local archive/restore, legacy-session preservation, concurrent-window creation guards, and ambiguous-result recovery. UI checks cover accessible navigation and submission states.
- Identity coverage includes read-only navigation, metadata-scoped memory-store recovery, absolute Markdown paths, partial provisioning, stale revisions, malformed-name repair, ambiguous writes, propagation delays, and preserving custom agent instructions. New conversations mount personal memory before accepting a message.
- Main-continuation coverage includes source-preserving chapter links, resumable preparation, ambiguous creation recovery, concurrent local windows, an in-flight message guard, changed-history detection, and lossless Unicode archive chunks. Archived tool records do not participate in current tool-approval decisions.
- Feed and Ideas coverage includes real-session result provenance, personal context construction, cloud feed-instruction conflicts, identity-scoped likes/discussion links, exact-ID recovery after ambiguous messages, concurrent-window generation guards, malformed outputs, safe source URLs, and delayed terminal telemetry. Reading an empty feed never provisions a session. Generated content remains separate from the main chat.
- Goal coverage includes validated categories and hierarchy, duplicate and cyclic record rejection, read-only navigation, explicit legacy import, preserving local originals, preventing resurrection of imported records, stale-edit detection, same-client write queues, same-origin Web Locks, malformed cloud data, and unresolved-write guards.
- Inline-question coverage includes bounded structured output, ordinary-code and quoted-example exclusion, malformed/incomplete blocks, text-only labels, stale-question detection, exact-event receipts, concurrent-tap guards, lost-response recovery without resending, account isolation, and history refreshes that retain live SSE updates while replacing stale local annotations.
- First-conversation coverage includes locale validation, real-event initiation, unchanged existing identities, embedded cloud-agent ownership, failed-read protection, concurrent local views, interrupted preparation, explicit retry after definitive rejection, ambiguous-result reconciliation, forged-annotation removal, and immediate first-reply bubble layout. Direct workspace checks preserve adopted/custom models and unconfirmed creations while repairing a rejected former default.
- Check-in and Upcoming coverage includes daytime, quiet-period, once-a-day, and unanswered-prompt gates; waiting while an approval or tool result is pending; local time-zone schedules across daylight-saving gaps and repeated hours; short months; ISO 8601 offset variants; no replay after pausing or on a new device; history-based skipping of another device's delivery; bounded batches; transactional claims with no resend after ambiguous or rejected results; prompt hiding on any device; and handing delivery to the Open Muse service, including re-registering a continued main chat and keeping the last known service answer when it is unreachable. These are mocked-upstream tests; check-ins, reminders, and service delivery have not yet been exercised against real MA or on a device.
- Apple Health request coverage includes the strict `health_read` tool schema, range and granularity validation, offering Share only where the iPhone's native reader exists, the connect sheet, the per-identity connection that answers reads automatically, and dismissing invalid requests. The native HealthKit reader is not part of the verified build.
- Direct-client coverage includes API key validation, OAuth PKCE, signing parity with the official SDK, secure-storage adapters, identity-scoped IndexedDB, cloud workspace recovery, ambiguous write protection, SSE, approvals, cloud goals and local saved replies, multipart uploads, and REST operation routing.
- The test-only legacy harness retains protocol and migration regression coverage. It is not shipped or started by the app. Signed-out requests cannot create conversations; upstream failures never produce replacement replies.
- The shared frontend production build and iOS Simulator build pass. Earlier verification covered a standalone macOS build and Android asset synchronization; neither establishes native acceptance of the current iOS feature set. The macOS development build is not notarized.

## Real MA on the web

The production assets were served by a static preview server without an application backend. A real API-key login, recovery of the existing cloud workspace, and two conversation turns passed: the second turn recalled the first turn's marker and doubled `42` to `84`. Saving a reply and reloading restored the session and conversation.

Browser request inspection confirmed that MA traffic went directly to the public Ark origin, not a local API service. Login uses a read-only MA agent-list request. The inference `/models` endpoint currently returns invalid CORS headers, so login and workspace preparation do not depend on it. Existing agents keep their model; new agents use the public default documented in the README, subject to actual project access.

## Real MA on iOS

Environment: iPhone 17 Pro, iOS 26.5 simulator. The app loads bundled assets and connects directly to the real Ark data plane. Native end-to-end verification passes:

1. A signed-out app presents SSO/API-key options, disables conversation submission, and displays no simulated replies. Service connection and Advanced setup are absent.
2. The real account reuses its existing workspace; the persistent main chat returned `42` and `84`, with the second round correctly restoring context.
3. A separate side chat returned its own marker. Returning to Chat restored the main conversation without mixing the messages.
4. The side chat was archived, found in the archived list, and restored without deleting or terminating its cloud session.
5. After terminating and relaunching the app, login and the main conversation were restored.
6. Keyboard tests keep the header visible and the multiline composer above the keyboard. Dismissing the keyboard restores the bottom navigation. The shell follows both the visual viewport height and its offset on iOS.
7. The Identity editor saved real `MEMORY.md` and `SOUL.md` documents and verified their cloud contents. Relaunching preserved the memory. The Save control remains hittable while editing; text inputs use at least 16px to prevent iOS focus zoom.
8. A new side chat read a marker from personal memory without that marker appearing in the message. A second turn applied the style rule saved in the persona document.
9. A request to remember a separate synthetic fact invoked real `memory_edit` and `memory_read` tools; the updated fact appeared in the iOS document viewer. Both documents were restored to their original contents after the test.
10. Editing the companion name updated the header and survived app termination and relaunch. The original name was restored and verified. Signed-out identity documents remain read-only starting templates.
11. An actual older app bundle seeded a main conversation without a memory mount. After upgrading the same simulator, its next turn read the previous context and correctly doubled `42` to `84`; both old and new reply bubbles remained in the same chat. The new main session used real `memory_edit` and readback, and the UI displayed the saved fact. Relaunch preserved both chapters. A separate read-only cloud audit confirmed exactly one continuation, unchanged original event history, a mounted memory store, a persisted context manifest, and restoration of temporary test memory.
12. Feed instructions saved to real MA memory and survived relaunch. A user-triggered run read personal memory and used `web_fetch`, returned two source-linked posts following the saved editorial instructions, and displayed them in the feed. A like survived relaunch, the instructions card stayed dismissed, and Discuss opened a draft containing the post and sources. Sending that draft produced a real MA conversation. Ideas generated four personalized suggestions and opened their detail sheets. Temporary feed instructions were restored. A separate cloud audit confirmed generated output, tool calls, source URLs, and the discussion's quoted context.
13. Choosing a goal category opened an explanation and editable chat starter. Real MA asked a clarifying question before an explicit request saved a two-step plan. Goals displayed the cloud-authored plan. Checking the first step in the UI persisted it; a new goal conversation read that progress and saved the second reported step. Marking the goal complete moved it into Completed goals, where it remained after relaunch. A separate read-only audit confirmed both completed steps, the completed goal status, real memory reads and edits in both conversations, and preservation of pre-existing cloud records.
14. Reopening a completed goal and renaming it passed against real MA memory. The rename editor uses a separate sheet sized to the visible viewport; Save remains hittable above the software keyboard. The changed name survived relaunch, and the test restored the original name. Completed steps remained unchanged. The chat keyboard regression also passed after the shared sheet change.
15. Real MA generated an inline question with three options. A single tap sent the visible label, and the next reply used that answer. The checked option and disabled older choices survived termination and relaunch. For a second generated question, typing an answer outside the supplied options continued the conversation and made the old controls read-only without selecting a false match. A separate read-only cloud audit confirmed exactly one selection message, one custom answer, and both expected replies. Touch-only devices no longer reveal a hover menu instead of activating a choice. The chat keyboard regression passed with this change.
16. An isolated fresh identity automatically provisioned a real workspace and requested a greeting without a typed first message. MA supplied Kit, Milo, and Muse. One tap chose Kit; actual memory editing and readback saved the name, the header changed, and MA asked a focused follow-up. A synthetic preference saved through MA was read by a separate new session without including its value in that session's prompt. Name, checked selection, and main history survived relaunch. A read-only audit confirmed one initiation, one name-selection message, real memory tools, the cloud name and preference, and unchanged original personal documents and conversations.
17. An existing memory-enabled main with an older app-instruction snapshot continued into exactly one linked MA session. Real MA accepted the pinned original agent version with updated app instructions. The next turn read the previous context and the saved preference, then generated a selectable inline question and responded to one selection. Old bubbles and the confirmed name option stayed in the same timeline; relaunch retained the new choice. A separate read-only audit verified unchanged original events, agent snapshot, model, tools, and personal documents, one successor, the same memory mount, and no repeated welcome. The first attempt caught MA's `vault_ids: null` representation for no bindings; this is accepted as empty, not treated as an incompatible connected account.

Instruction-refresh regression coverage includes canonical object-key ordering,
pinned model/tool versions, preserving custom session text, refusing ambiguous
app blocks and unsafe runtime/resource configurations, English/Chinese error
copy, and releasing a recognized preparation refusal so side-chat creation is
still possible. Cloud/network failures retain the existing recovery guards;
unconfirmed writes are not automatically repeated.

Reply saving through the message's long-press menu, library source navigation,
and restoration after relaunch also pass with real MA replies. Touch-and-hold
opens the app's action sheet; Copy remains available there rather than relying
on the system text-selection menu.

Earlier real verification also covered `web_fetch` reading a public example page and returning its title, with the execution record retaining the auto-approval result. The Feed test exercised `web_fetch` again; it did not force a manual-approval policy to re-test that older approval scenario.

Repeated logins with the same connection reuse one set of workspace mappings. The tests did not send email, make purchases, or delete cloud resources.

Credentials use a dedicated direct-client Keychain service. Simulator builds enable ad-hoc signing for Keychain access; storage failures remain visible and do not fall back to an anonymous workspace. The signed-out UI test uses a separate debug-only credential namespace without deleting the real login.

Fresh-identity live acceptance uses a random `MUSE_UI_TEST_PROFILE` in debug
simulator builds only. It changes non-secret identity/mapping ownership, not
credentials or the API origin, and creates separate real MA resources. This
keeps the normal main conversation and personal memory intact. The profile
does not bypass eligibility checks or substitute mocked replies. A subsequent
restoration case uses the last acceptance profile without requesting another
generation. These synthetic cloud resources are retained for inspection, not
silently deleted.

## Real MA on macOS

The standalone app loaded bundled assets at `muse://app/`, signed in directly with the authorized API key, and read the real iOS verification conversation, including both answers. Saving the second answer to Library verified local IndexedDB writes. After rebuilding and relaunching the app, the Keychain login, cloud conversation list, and local Library entry were restored. No additional conversation turn or cloud resource creation was needed for this check.

### Desktop Library and settings window, read-only

Both surfaces were accepted on frozen, code-signed builds driven through the real UI, with no message sent, no file written, no removal confirmed, no memory document saved, and no cloud or OS setting changed.

Library: the seven-category sidebar and category navigation; the empty state and the truthful unavailable copy for images, podcasts and system files; the memory-document entries opening the existing editor; creation seeding an unsent composer draft beside the workspace, the replacement prompt for an existing draft, and keeping the draft on "keep"; reselecting Library collapsing the side-by-side chat while holding the category; search replacing the header, hiding the list controls, showing the query-specific empty state, and the clear control restoring the category; selection replacing the header with a selected count, a disabled destructive action, select-all, and both exits; one previously saved reply rendering as a card, its reading surface, pin and unpin, the source conversation opening the right session, sorting and grid/list switching; the macOS save panel opening for a Markdown export and reporting a cancelled export without writing a file; and the removal confirmation naming this Mac, the preserved cloud conversation and undo, with cancel leaving the record in place.

Settings: Command-comma and the rail entry opening one separate 800 × 600 window with an accessible title, a disabled zoom and resize, and a working close; the section list starting below the traffic lights; the three section names the reference leaves in English rendering that way while the rest are localized; the connection, language and about groups; the collapsed sign-in panel; the version; the permission section reporting the real rules with no editable control; both sign-out paths stopping at the same confirmation and cancelling without signing out; reopening keeping the selected section without creating a second window; and Command-W closing only the settings window while the workspace kept its page.

Appearance: the light and dark settings surfaces, the three-way control keeping its choice across a close and reopen, the workspace following the settings window into dark and back, the chat header scrim and the feed prompt card reading correctly in dark, the library preview and the dark native save panel, and the primary action label staying readable enabled and disabled in both appearances. Brand illustration colors stay fixed by design.

Navigation: the rail, the ideas heading and landmark, and the library landmarks reading as the sections they open.

Not established by these checks: interactive cloud authorization from these builds, an actually executed sign-out, the cross-window refresh after a credential write, dark parity against the reference app, whose own dark rendering has not been observed, any surface that needs populated cloud data, and any theme, startup, shortcut, language-choice, account, usage, connector, computer-use, file-system, dictation, wallet, message-channel or device capability, none of which this shell implements yet.

## How to reproduce

```bash
npm ci
npm run check
npm run build
npm run ios:build
```

`ios/App/MuseUITests/MuseUITests.swift` contains a default signed-out connection test and live cases explicitly enabled via the `MUSE_LIVE_TESTS` compilation condition. Live cases incur cloud calls and must not be the default for CI without credentials. Application runtime paths never generate simulated replies; mocked responses are confined to test fixtures.

The UI tests require no backend or listening port. Live cases need internet access and a test key supplied via the simulator clipboard when signed out. Do not put keys in source code, command arguments, or launch environment. Clear the clipboard afterward; result bundles and screenshots stay only in ignored local test directories.

## Not covered

- The current conversation-shell revision has not been installed on a physical iPhone. An earlier revision was installed and launched with local development signing. Android builds and device interaction remain unverified; the local environment lacks JDK 21 and Android SDK 36.
- The full real SSO authorization flow was not re-run this round. Automated PKCE, token exchange, signing, and project-selection tests pass; public endpoint CORS preflights were also checked. These checks do not establish a real interactive SSO result.
- Real-account permissions for all 52 MA operations, full MCP OAuth, real skills, and file uploads.
- Multi-tenant public deployment, concurrent performance, a full security audit, and app store release.
- Continuation across separate devices: the main-chat chapter index and in-flight write guards are device-local. Cross-device concurrent migration is not covered. Old-side-chat continuation, transferring sandbox files, and reviving running tools in a new session are not implemented.
- Goal document access from separate physical devices, concurrent agent/device edits, goal/subgoal deletion, and pixel-level parity of goal detail sheets remain unverified. The real goal tests cover one category, a two-step plan, progress updates, completion, renaming with the keyboard open, and relaunch; they do not establish autonomous tracking or scheduling.
- Inline-question selection receipts are device-local. Cross-device selection deduplication and automatically upgrading the prompt of an existing memory-enabled main session remain unverified. New conversations receive the question format; rendering a valid block does not by itself establish model compliance on every turn.
- Full product parity: spontaneous check-ins, fully verified background Feed/Ideas delivery, autonomous goal tracking, artifacts/media, attachments, avatar customization, and native voice input remain separate implementation and acceptance work. First-run introduction and a naming follow-up are implemented, not a general proactive scheduler. Posts, reactions, and discussion links remain device-local; the separate background service has not been accepted as part of this iOS workflow. The microphone control currently focuses the message field for keyboard dictation; it does not record audio itself. Desktop explicitly reports that no interactive remote desktop is connected, and scheduled memory maintenance is not claimed. Cross-device first-run coordination and exact wording/pixel parity are unverified.
