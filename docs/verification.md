# Verification record

Verification date: 2026-09-30. Mocked-upstream regression tests are distinguished from real cloud tests. No personal credentials, accounts, resource IDs, or raw logs are included.

Current acceptance focuses on iOS. The web and macOS results below record earlier direct-client verification, not acceptance of the latest companion, Feed, or Ideas interfaces on those platforms.

## Automated checks

- TypeScript checks pass; 21 test files and 409 tests pass, including 82 direct-client cases.
- Conversation coverage includes lazy main-session creation, restart recovery, independent side chats, identity isolation, local archive/restore, legacy-session preservation, concurrent-window creation guards, and ambiguous-result recovery. UI checks cover accessible navigation and submission states.
- Identity coverage includes read-only navigation, metadata-scoped memory-store recovery, absolute Markdown paths, partial provisioning, stale revisions, malformed-name repair, ambiguous writes, propagation delays, and preserving custom agent instructions. New conversations mount personal memory before accepting a message.
- Main-continuation coverage includes source-preserving chapter links, resumable preparation, ambiguous creation recovery, concurrent local windows, an in-flight message guard, changed-history detection, and lossless Unicode archive chunks. Archived tool records do not participate in current tool-approval decisions.
- Feed and Ideas coverage includes real-session result provenance, personal context construction, cloud feed-instruction conflicts, identity-scoped likes/discussion links, exact-ID recovery after ambiguous messages, concurrent-window generation guards, malformed outputs, safe source URLs, and delayed terminal telemetry. Reading an empty feed never provisions a session. Generated content remains separate from the main chat.
- Goal coverage includes validated categories and hierarchy, duplicate and cyclic record rejection, read-only navigation, explicit legacy import, preserving local originals, preventing resurrection of imported records, stale-edit detection, same-client write queues, same-origin Web Locks, malformed cloud data, and unresolved-write guards.
- Inline-question coverage includes bounded structured output, ordinary-code and quoted-example exclusion, malformed/incomplete blocks, text-only labels, stale-question detection, exact-event receipts, concurrent-tap guards, lost-response recovery without resending, account isolation, and history refreshes that retain live SSE updates while replacing stale local annotations.
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

Reply saving through the message's long-press menu, library source navigation,
and restoration after relaunch also pass with real MA replies. Touch-and-hold
opens the app's action sheet; Copy remains available there rather than relying
on the system text-selection menu.

Earlier real verification also covered `web_fetch` reading a public example page and returning its title, with the execution record retaining the auto-approval result. The Feed test exercised `web_fetch` again; it did not force a manual-approval policy to re-test that older approval scenario.

Repeated logins with the same connection reuse one set of workspace mappings. The tests did not send email, make purchases, or delete cloud resources.

Credentials use a dedicated direct-client Keychain service. Simulator builds enable ad-hoc signing for Keychain access; storage failures remain visible and do not fall back to an anonymous workspace. The signed-out UI test uses a separate debug-only credential namespace without deleting the real login.

## Real MA on macOS

The standalone app loaded bundled assets at `muse://app/`, signed in directly with the authorized API key, and read the real iOS verification conversation, including both answers. Saving the second answer to Library verified local IndexedDB writes. After rebuilding and relaunching the app, the Keychain login, cloud conversation list, and local Library entry were restored. No additional conversation turn or cloud resource creation was needed for this check.

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
- Full product parity: automatic first-run introductions and spontaneous check-ins, automatic background Feed/Ideas delivery, autonomous goal tracking, artifacts/media, attachments, avatar customization, and native voice input remain separate implementation and acceptance work. Feed and Ideas generation is user-triggered; posts, reactions, and discussion links are device-local. The microphone control currently focuses the message field for keyboard dictation; it does not record audio itself. Desktop explicitly reports that no interactive remote desktop is connected, and scheduled memory maintenance is not claimed.
