# CLAUDE.md

## Language

- English is the default for everything in this repository: code comments, identifiers, documentation, READMEs, commit messages, and user-facing UI copy.
- Do not introduce Chinese (or other non-English) text into tracked files unless the content itself is the subject of code (for example, multi-byte UTF-8 decoding fixtures).
- When talking to the user, match the language they use in the conversation; repository artifacts stay in English.

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

All four platforms connect directly to public Volcano APIs through SSO or an in-app API key. There is no Open Muse backend or service URL. Without credentials the app stays disconnected and never generates simulated replies. Real calls may incur cloud costs. Mock responses and the old server migration harness belong only in tests and must never be bundled.

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
