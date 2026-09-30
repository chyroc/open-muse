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

- `src/` — React UI and direct MA client; `src/direct/` owns local auth, storage, and provisioning
- `shared/` — event types, approval policy, and the MA API catalog/contract
- `ios/` — Capacitor + SwiftPM iOS project
- `macos/` — AppKit/WKWebView shell loading bundled static assets, with no server or Node runtime
- `android/` — retained Capacitor project (no build/device verification yet)
- `tests/` — unit, API, and frontend tests (Vitest)
- `scripts/` — build and asset generation
- `docs/` — integration notes and verification records

All four platforms connect directly to public Volcano APIs through an in-app API key. There is no Open Muse backend or service URL. Without credentials the app stays disconnected and never generates simulated replies. Real calls may incur cloud costs. Mock responses and the old server migration harness belong only in tests and must never be bundled.

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

- Run `npm run check` and `npm run build` before committing. When changing native bridges or assets, also verify the affected platform build; state explicitly which checks were not run.
- Use Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), one logical change per commit.
- Commit only source code, required build configuration, reproducible tests, and public documentation. Never commit credentials, databases, private hostnames, personal paths, device logs, IPAs, or DMGs.
- Keep generated artifacts and personal research in ignored local directories (`.build/`, `.data/`, `resources/`, `references/`).
- Stage files selectively; review `git diff --cached` and `git diff --cached --check` before committing.
- Docs describe current behavior and usage, not work history. Real cloud testing requires explicit authorization and non-destructive cases.

## Safety boundaries

- Each client owns its credentials and local data. The static web host must never receive credentials or proxy MA traffic.
- Native credentials use Keychain or Android Keystore-backed encryption. Web credentials stay in sessionStorage; all remain sensitive to a compromised client.
- Non-secret records live in identity-scoped IndexedDB. Preserve legacy local data on upgrades; do not silently migrate credentials or delete old files.
- Auto-approval only covers pending `web_search` / `web_fetch` requests matched by exact protocol name; everything else stays manual.
- Write requests are never auto-retried; when a result is ambiguous, query history first instead of repeating creation or approval.
