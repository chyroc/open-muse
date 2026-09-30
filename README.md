# Open Muse

A personal AI task assistant built on Volcano Ark Managed Agents (MA). The web,
iOS, Android, and macOS apps connect directly to Volcano APIs. No Open Muse
backend, local API service, app access token, or server URL is required.

Conversations use real MA responses. Without an Ark connection the app stays
signed out; network failures never produce simulated replies. Cloud calls and
cloud environments may incur charges.

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
`doubao-seed-2-0-pro-260215`; the Ark project must have access to it. Model access
errors remain visible. The inference `/models` endpoint currently has invalid
CORS responses, so neither sign-in nor workspace preparation depends on it.

## Storage and security

- iOS and macOS keep API keys and SSO credentials in Keychain. Android encrypts
  credentials with an Android Keystore-backed AES-GCM key and disables backup.
- The web app keeps credentials in `sessionStorage`, not persistent local
  storage. A page reload preserves the browser session; signing out clears it.
  Browser extensions or injected scripts can still access browser-held secrets:
  use a trusted host, avoid shared profiles, and revoke compromised keys in Ark.
- Workspace mappings, session metadata, goals, saved replies, and local approval
  records live in IndexedDB. They contain no raw API keys, but conversation
  content is not encrypted by the app. Protect the device/browser profile.
- Goals and saved replies are device-local, not automatically synced across
  devices. Conversations and execution history are read directly from MA.
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

## Capabilities

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
