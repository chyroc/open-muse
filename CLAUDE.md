# CLAUDE.md

## Language

- English is the default for everything in this repository: code comments, identifiers, documentation, READMEs, commit messages, and user-facing UI copy.
- Do not introduce Chinese (or other non-English) text into tracked files unless the content itself is the subject of code (for example, multi-byte UTF-8 decoding fixtures).
- When talking to the user, match the language they use in the conversation; repository artifacts stay in English.

## Project

Open Muse is a personal AI task assistant built on Volcano Ark Managed Agents (MA). It ships a mobile-first web app, an iOS app, a macOS native shell, and a retained Android project.

- `src/` — React UI and client adapters
- `shared/` — event types, approval policy, and the MA API catalog/contract
- `server/` — OAuth, encrypted credentials, Ark adapter, and the BFF (Express)
- `ios/` — Capacitor + SwiftPM iOS project
- `macos/` — AppKit/WKWebView shell embedding the server
- `android/` — retained Capacitor project (no build/device verification yet)
- `tests/` — unit, API, and frontend tests (Vitest)
- `scripts/` — build and asset generation
- `docs/` — integration notes and verification records

The app runs in a local **demo mode by default**: no model calls and no external actions. Real Ark mode is enabled via SSO or a server-side API key and may incur cloud costs.

## Commands

```bash
npm ci
npm run dev          # web on 4310, server on 4311
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

- The project is meant for personal local use or controlled single-user deployment, not public multi-tenant hosting.
- Ark credentials are encrypted with AES-256-GCM (`0600` perms); encryption does not protect against an attacker with filesystem access.
- Auto-approval only covers pending `web_search` / `web_fetch` requests matched by exact protocol name; everything else stays manual.
- Write requests are never auto-retried; when a result is ambiguous, query history first instead of repeating creation or approval.
