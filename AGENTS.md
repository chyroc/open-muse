# AGENTS.md

## Language

- Keep repository documentation (including all READMEs), code comments, identifiers, and commit messages in English. Do not translate existing documentation.
- iOS and macOS user-facing interfaces support English and Simplified Chinese. On launch, follow the system/app preferred-language list, select the first supported English or Chinese preference, and fall back to English if none matches. Chinese locale variants use Simplified Chinese. Do not hard-code an English UI or persist an independent language override by default.
- Keep app-authored labels, accessibility text, empty states, confirmations, and errors in the shared localization catalog (`shared/locales/zh-CN.ts`) and use `shared/i18n.ts`. Native macOS menus and dialogs use the matching `macos/*.lproj/Localizable.strings` resources. Dates and times use the selected language's locale.
- Chinese text is allowed in localization resources and localization tests. Keep protocol names, API fields, resource IDs, file names, and machine-readable values unchanged. Never translate user-authored content, chat history, model output, or raw upstream diagnostic payloads as UI copy.
- Add matching translations and tests when introducing user-facing copy. Verify both languages and the system-language fallback in affected Apple clients.
- When talking to the user, match the language they use in the conversation.

## Project

Open Muse is a personal AI task assistant built on Volcano Ark Managed Agents (MA). It ships a mobile-first web app, an iOS app, a macOS native shell, and a retained Android project.

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

Builds configured with `VITE_MUSE_BACKGROUND_URL`, `VITE_MUSE_SUPABASE_URL`, and `VITE_MUSE_SUPABASE_ANON_KEY` use an Open Muse account (Supabase Auth email/password) as the user's identity. The Ark API key is only the model-service credential: it is stored encrypted per account by the Open Muse service, read back only by that account's verified sessions, and scoped with the account owner so accounts sharing one key keep separate workspaces, memory, history, and local records. Clients still call public Volcano Ark APIs directly with that key. Builds without that configuration run in single-user local mode with a device-held API key. Volcano SSO is not supported. Without credentials the app stays disconnected and never generates simulated replies. Real calls may incur cloud costs. Mock responses and the old server migration harness belong only in tests and must never be bundled.

## Commands

```bash
npm ci
npm run dev          # frontend only, on 4310
npm run check        # tsc --noEmit + vitest run
npm test             # vitest run
npm run build        # type-check + production web build
npm run macos:build  # standalone macOS app
npm run ios:build    # iOS Simulator app
```

Requires Node.js 22.21+. Native Apple builds require Xcode.

## Conventions

- Commit automatically: once a logical change is complete and its required checks pass, commit it without waiting to be asked. Do not push unless explicitly requested. If a required check fails or cannot be run, leave the change uncommitted and report why.
- Run `npm run check` and `npm run build` before committing. When changing native bridges or assets, also verify the affected platform build; state explicitly which checks were not run.
- Use Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), one logical change per commit.
- Commit only source code, required build configuration, reproducible tests, and public documentation. Never commit sensitive information of any kind: credentials, API keys, tokens, passwords, secrets, databases, private hostnames, personal paths, device logs, IPAs, or DMGs. Never commit confidential company information, including internal product names, internal hosts or URLs, internal tools, and unreleased code or documents.
- Keep generated artifacts and personal research in ignored local directories (`.build/`, `.data/`, `resources/`, `references/`).
- Stage files selectively; review `git diff --cached` and `git diff --cached --check` before committing.
- Docs describe current behavior and usage, not work history. Real cloud testing requires explicit authorization and non-destructive cases.

## Concurrent sessions

- Multiple sessions may work in the same directory at the same time. The worktree, branch, Git index, running processes, and generated output are shared; never assume exclusive ownership.
- Check `git status --short` and relevant diffs before editing. Re-read the target content immediately before applying changes; unexpected changes may belong to another active session.
- Keep edits scoped to the current task. Preserve unrelated changes, including untracked files; never overwrite, revert, delete, or stash another session's work. Avoid repository-wide formatting or cleanup.
- If concurrent edits overlap and cannot be safely combined, pause work on that file and coordinate with the user or the other session. Continue independent work where possible.
- Stage and commit only this session's changes, using selective hunks when a file contains shared edits. Inspect the shared index before staging and committing; never unstage or commit another session's changes. Branch switches and worktree-wide Git operations require explicit authorization and coordination.
- Do not stop another session's processes. Use session-specific temporary and build paths where supported, and coordinate commands that overwrite shared generated output.

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
- Respect the user's Reduce Motion setting: replace large movement with short opacity/scale crossfades instead of dropping animation entirely.
- Match dark/light appearance, Dynamic Type, and the localization catalog; motion and layout must hold up in both English and Simplified Chinese.

Before considering a screen done, run it on the target device and compare the interaction rhythm against the reference. If a transition feels mechanical, tune the spring/timing first instead of accepting it.

## Safety boundaries

- The account owner comes only from a session verified by the configured Auth provider, never from client input, an email, or an Ark key digest. The static web host must never receive credentials or proxy MA traffic; the Open Muse service never logs keys, tokens, or passwords and never uses a service-role Auth key.
- Native credentials use Keychain or Android Keystore-backed encryption. Web credentials stay in sessionStorage; all remain sensitive to a compromised client. In account builds the Ark key is held in memory only.
- Non-secret records live in identity-scoped IndexedDB. Preserve legacy local data on upgrades; do not silently migrate credentials, attribute earlier local data to an account, or delete old files.
- Auto-approval only covers pending `web_search` / `web_fetch` requests matched by exact protocol name, plus Mac computer-control calls (screenshot, input, open, app list) while the person has chosen "Always allow" for that device in Computer use settings; the policy defaults to asking, never covers Calendar, Location or other device tools, and everything else stays manual.
- Write requests are never auto-retried; when a result is ambiguous, query history first instead of repeating creation or approval.
