# AGENTS.md

## Language

- Keep repository documentation, code comments, identifiers, and commit messages in English. Do not translate existing documentation. The one exception is `README.zh-CN.md`, the Simplified Chinese counterpart of `README.md` (see README below).
- iOS and macOS user-facing interfaces support English and Simplified Chinese. On launch, follow the system/app preferred-language list, select the first supported English or Chinese preference, and fall back to English if none matches. Chinese locale variants use Simplified Chinese. Do not hard-code an English UI or persist an independent language override by default.
- Keep app-authored labels, accessibility text, empty states, confirmations, and errors in the shared localization catalog (`shared/locales/zh-CN.ts`) and use `shared/i18n.ts`. Native macOS menus and dialogs use the matching `macos/*.lproj/Localizable.strings` resources. Dates and times use the selected language's locale.
- Text the app writes for the model on the user's behalf, such as the prompt an idea puts in the composer, follows the selected UI language like any other app-authored copy.
- Chinese text is allowed in localization resources and localization tests. Keep protocol names, API fields, resource IDs, file names, and machine-readable values unchanged. Never translate user-authored content, chat history, model output, or raw upstream diagnostic payloads as UI copy.
- Add matching translations and tests when introducing user-facing copy. Verify both languages and the system-language fallback in affected Apple clients.
- When talking to the user, match the language they use in the conversation.

## Project

Open Muse is a personal AI task assistant built on a Managed Agents (MA) service. It ships a mobile-first web app, an iOS app, a macOS native shell, and a retained Android project.

Volcano Ark MA is the default and reference backend; Claude Managed Agents is an alternative selected with `VITE_MUSE_MA_PROVIDER` / `MA_PROVIDER`. Every backend difference lives in `shared/ma-provider.ts`. Ark comes first: build and verify features on Ark, and where Ark has a capability Claude lacks, leave it out on Claude instead of emulating it.

Current focus: the iOS app comes first, the macOS app second. Do not modify the web app or the Android project unless explicitly requested.

Goals for the iOS app:

1. Read iOS health data (HealthKit), including on-demand reads triggered from the conversation, e.g. asking "how was my workout today?" triggers a fresh health query.
2. Carry out arbitrary Lark (Feishu) operations through lark-cli.

Goals for the macOS app:

1. Operate the Mac through computer-use integration.
2. Carry out arbitrary Lark (Feishu) operations through lark-cli.

- `src/` — React UI and direct MA client; `src/direct/` owns local auth, storage, and provisioning
- `shared/` — event types, approval policy, and the MA API catalog/contract
- `server/` — Open Muse service (Cloudflare Worker + D1): Open Muse account verification, per-account encrypted Ark keys, background work
- `ios/` — Capacitor + SwiftPM iOS project
- `macos/` — AppKit/WKWebView shell loading bundled static assets, with no server or Node runtime
- `android/` — retained Capacitor project (no build/device verification yet)
- `tests/` — unit, API, and frontend tests (Vitest)
- `scripts/` — build and asset generation
- `docs/` — integration notes and verification records

The account build is the default: build, run, and verify features as an account build, because background work and the other Open Muse service capabilities exist only there. Builds configured with `VITE_MUSE_BACKGROUND_URL`, `VITE_MUSE_SUPABASE_URL`, and `VITE_MUSE_SUPABASE_ANON_KEY` use an Open Muse account (Supabase Auth email/password) as the user's identity. The Ark API key is only the model-service credential: it is stored encrypted per account by the Open Muse service, read back only by that account's verified sessions, and scoped with the account owner so accounts sharing one key keep separate workspaces, memory, history, and local records. Clients still call public Volcano Ark APIs directly with that key. Builds without that configuration run in single-user local mode with a device-held API key; keep that mode working, but treat it as a fallback rather than the target. Volcano SSO is not supported. Without credentials the app stays disconnected and never generates simulated replies. Real calls may incur cloud costs. Mock responses and the old server migration harness belong only in tests and must never be bundled.

## README

- `README.md` (English, the default) and `README.zh-CN.md` (Simplified Chinese) introduce the project to new readers: what Open Muse does, why it is worth trying, screenshots, the supported apps, a short getting-started, and links to the docs. Each links to the other on its first lines.
- Keep both READMEs in step: same sections, same claims, same screenshots. Change one, change the other in the same commit.
- Keep development and implementation detail out of the READMEs. Building, running, account builds, native projects, and project layout belong in `docs/development.md`; detailed behavior (accounts, storage and security, conversations, memory, goals, reminders, Feed and Ideas) belongs in `docs/how-it-works.md`. The READMEs only link to them. Those docs stay in English.
- Every capability a README claims must exist in the current code. Describe limits honestly; do not advertise unverified or unreleased features.
- README screenshots live in `docs/images/`. Capture them from a real build with a test account and non-sensitive data, show only app windows (no terminal, desktop, personal paths, account IDs, keys, or other people's data), resize to at most 1600 px wide, and replace a screenshot when the screen it shows changes noticeably.
- Keep the image count small: one row of six iOS screenshots and one row of six Mac screenshots. Replace an existing image rather than adding another, since every committed image stays in history.

## Commands

```bash
npm ci
npm run dev          # frontend only, on 4310
npm run check        # tsc --noEmit + vitest run
npm test             # vitest run
npm run build        # type-check + production web build
npm run macos:build  # macOS app, always an account build
npm run ios:install  # iOS account build, signed and installed on a paired iPhone
npm run ios:build    # iOS Simulator app (an account build only when the three values are set)
```

Requires Node.js 22.21+. Native Apple builds require Xcode. Account build values and how the build scripts obtain them are described in `docs/development.md`.

## Conventions

- Commit automatically: once a logical change is complete and its required checks pass, commit it without waiting to be asked. Do not push unless explicitly requested. If a required check fails or cannot be run, leave the change uncommitted and report why.
- Run `npm run check` and `npm run build` before committing. When changing native bridges or assets, also verify the affected platform build; state explicitly which checks were not run.
- Chain the checks and the commit so a failure stops the commit (`&&`), or confirm every exit code first. A partial test run does not replace the full gate.
- Report verification by the evidence it rests on: unit tests or protocol doubles, a native build, Simulator or device UI, or real cloud calls. Do not present a lower level as a higher one, and do not describe a build from a dirty worktree as the build of a commit.
- Use Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), one logical change per commit.
- Commit only source code, required build configuration, reproducible tests, and public documentation. Everything that enters the repository or its remote counts: code, comments, identifiers, strings, tests, fixtures, assets, docs, scripts, commit messages, branch names, tags, and PR text. None of it may contain:
  - Sensitive information of any kind: credentials, API keys, tokens, passwords, secrets, account or tenant IDs, databases, private hostnames or IPs, personal paths, real names or emails beyond the commit author, device logs, IPAs, or DMGs.
  - Company-internal information: internal product, project or codenames, internal hosts or URLs, internal tools, platforms or environments, internal processes, and unreleased code or documents.
  - Competitor information: the names of other products or companies used as a reference, their app names, bundle IDs, versions or build numbers, internal class, component or file names, strings, copy, assets, extracted code, and any tooling or notes that inspect, extract from, or compare against their apps. Refer to them only as "the reference app", and only for observable behavior as described under Interaction and motion.
- If a change would need any of the above, keep it in ignored local files instead and leave it out of the commit. When such content is found in history, report it rather than working around it; removing it requires a history rewrite, which needs the user's explicit approval.
- Keep generated artifacts and personal research in ignored local directories (`.build/`, `.data/`, `resources/`, `references/`).
- Stage files selectively; review `git diff --cached` and `git diff --cached --check` before committing.
- Docs describe current behavior and usage, not work history. Real cloud testing requires explicit authorization and non-destructive cases. After testing on a real account, list the test data left behind (side chats, reminders, documents) so the user can decide whether to delete it.
- Work directly on `master`. Do not create branches or worktrees unless the user asks for them.

## Concurrent sessions

- Multiple sessions may work in the same directory at the same time. The worktree, branch, Git index, running processes, and generated output are shared; never assume exclusive ownership.
- Check `git status --short` and relevant diffs before editing. Re-read the target content immediately before applying changes; unexpected changes may belong to another active session.
- Keep edits scoped to the current task. Preserve unrelated changes, including untracked files; never overwrite, revert, delete, or stash another session's work. Avoid repository-wide formatting or cleanup.
- If concurrent edits overlap and cannot be safely combined, pause work on that file and coordinate with the user or the other session. Continue independent work where possible.
- Stage and commit only this session's changes, using selective hunks when a file contains shared edits. Inspect the shared index before staging and committing; never unstage or commit another session's changes. Branch switches and worktree-wide Git operations require explicit authorization and coordination.
- Do not stop another session's processes. Use session-specific temporary and build paths where supported, and coordinate commands that overwrite shared generated output.
- The screen, the Simulator, and running app instances are shared too. Run your own app instance with its own profile (`--open-muse-profile <name>` on the Mac), bring your own window to the front by process ID and confirm it is frontmost before every real click or keystroke, leave a Simulator another session is using alone, and avoid global shortcuts such as Option-Space while another session drives the screen.

## Interaction and motion

The iOS and macOS apps target the interaction and animation quality of a polished first-party companion app. Calibrate the *feel* against a best-in-class reference app on a real device.

- Experience the reference app directly (on-device, in the Simulator, or via screen recording). Capture observable behavior only: what moves, in which direction, for how long, with what easing, and how it responds to input.
- Translate observations into concrete, named motion specs we own — duration, spring response/damping ratio, content-transition style, opacity/scale/offset curves, gesture thresholds, and haptics. Put shared numbers in one place rather than scattering magic values.

What "not stiff" means in practice:

- Prefer spring curves over linear/ease-in-out for anything driven by touch or focus; reserve ease-out/ease-in curves for short non-interactive fades.
- Views follow gestures while they happen, not after they finish; cancellation springs back to the rest state.
- Navigation and sheet transitions carry their content (shared-element feel where reasonable) and keep interactive pop/dismiss working.
- Message streams animate insertion, updates, and loading as a continuous flow; typing/streaming state settles without jumps, and keyboard tracking never fights the scroll position.
- Buttons and rows have press feedback (scale/opacity/highlight) that releases on touch-up; nothing should only react on tap-end.
- Transient connection trouble (an aborted request, a dropped stream, a reconnect) recovers quietly in the background. Show an error only when something the person did, such as sending a message or saving a change, actually failed, and never show raw platform text such as `The operation was aborted`.
- Respect the user's Reduce Motion setting: replace large movement with short opacity/scale crossfades instead of dropping animation entirely.
- Match dark/light appearance and the localization catalog; motion and layout must hold up in both English and Simplified Chinese. Text keeps the reference type scale at every standard Dynamic Type size and grows only at the accessibility sizes, so layouts must hold up at those too.

Before considering a screen done, run it on the target device and compare the interaction rhythm against the reference. If a transition feels mechanical, tune the spring/timing first instead of accepting it.

## Safety boundaries

- The account owner comes only from a session verified by the configured Auth provider, never from client input, an email, or an Ark key digest. The static web host must never receive credentials or proxy MA traffic; the Open Muse service never logs keys, tokens, or passwords and never uses a service-role Auth key.
- Native credentials use Keychain or Android Keystore-backed encryption. Web credentials stay in sessionStorage; all remain sensitive to a compromised client. In account builds the Ark key is held in memory only.
- Non-secret records live in identity-scoped IndexedDB. Preserve legacy local data on upgrades; do not silently migrate credentials, attribute earlier local data to an account, or delete old files.
- Auto-approval only covers pending `web_search` / `web_fetch` requests matched by exact protocol name, plus Mac computer-control calls (screenshot, input, open, app list) while the person has chosen "Always allow" for that device in Computer use settings, plus `health_read` on the iPhone once the person has connected Apple Health through the app's connect sheet or Connectors (kept per identity on that device; Disconnect in Connectors returns to asking). The policy defaults to asking, never covers Calendar, Location or other device tools, and everything else stays manual.
- Write requests are never auto-retried; when a result is ambiguous, query history first instead of repeating creation or approval.
