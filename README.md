# Open Muse

A personal AI task assistant built on Volcano Ark Managed Agents (MA), with iOS, macOS, and mobile-first web interfaces, plus a retained Android project.

Supports continuous conversations, tool approvals, execution records, goal management, saved replies, and Markdown export. The default demo mode does not call models or perform external actions; once connected to real MA, cloud calls may incur charges.

## Quick start

Requires Node.js 22.21+. Building for native Apple platforms requires Xcode.

```bash
npm ci
npm run dev           # Web on 4310, server on 4311
npm run check         # Type checks and automated tests
npm run build         # Production web build
npm run macos:build   # Standalone macOS app
npm run ios:build     # iOS Simulator app
```

Dev page: [http://127.0.0.1:4310](http://127.0.0.1:4310). For production mode, run `npm run build && npm start` and visit [http://127.0.0.1:4311](http://127.0.0.1:4311).

## Connect to Ark

### SSO login

1. Open **Settings → Connect to Ark MA → Volcano SSO**, then click **Start SSO login**.
2. Complete authorization on the Volcano website, then paste the authorization code or full callback URL back into the app.
3. Select a project, review the permissions and billing notes, then click **Connect project and get started**.
4. Wait for the workspace to become ready, then start a conversation.

The server exchanges the code for STS via OAuth + PKCE and creates a project API key. This key can access all Ark resources in the selected project and is not restricted by source IP. The authorization transaction is valid for 10 minutes and can be exchanged only once; the app login session is valid for 7 days.

### Enter an API key manually

1. Open **Settings → Connect to Ark MA → API Key**.
2. Paste an existing key; the project name is optional — leave it blank and Ark determines the project from the key.
3. Click **Connect API key**. The server first validates it via `/models`, then stores the credentials encrypted.
4. The agent and environment are created automatically when you first send a task or click **Prepare workspace**.

The Agent/Environment mapping is stored in local SQLite, isolated by upstream address, key digest, and project. Reconnecting with the same configuration reuses the mapping, so users do not need to enter resource IDs. If creation fails, completed steps are retained; when the result is unclear, the server queries first rather than blindly creating duplicates.

The client holds only the app session token. iOS and macOS restore the token via Keychain; web stores it only in the current `sessionStorage`. Logging out removes the login credentials saved by the app but does not revoke the cloud API key; revocation must be done in the Ark console.

Both login methods use the production data plane by default. A server administrator can set a trusted upstream via `MUSE_SSO_ARK_BASE_URL`; clients cannot submit arbitrary upstream addresses. API keys do not provide STS, so control-plane operations that require STS still need SSO.

### Server configuration

Create a local `.env` from `.env.example`. To use a server-side key directly, configure:

```dotenv
MUSE_MODE=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_API_KEY=fill-in-your-key-locally
```

Optionally set `ARK_PROJECT_NAME` to specify the project via `X-Project-Name`. `ARK_MODEL_ID` selects the model; leave it blank to automatically pick a text model that supports tool calls. `ARK_AGENT_ID` and `ARK_ENVIRONMENT_ID` exist for compatibility with existing deployments and are not shown in the regular UI.

## Native clients

### iOS

The project is `ios/App/App.xcodeproj`, the scheme is `App`, and the bundle ID is `app.openmuse.mobile`. It uses Capacitor and Swift Package Manager; run `npm run ios` to open it in Xcode.

On first run, enter the **Open Muse server root URL**, not the Ark API URL. The simulator can use `http://127.0.0.1:4311`; a physical device needs a reachable HTTPS server, since a loopback address on the phone cannot reach the Mac.

iOS does not embed the server. SSO external links use the system browser, and exports use the system share sheet. Simulator builds use ad-hoc signing; do not disable signing, or Keychain may return permission errors.

Device builds require a valid local Apple development identity and provisioning profile. Run `npm run ios:build:device -- DEVELOPMENT_TEAM=your-team-id -allowProvisioningUpdates`; the output is at `.build/ios-device/Build/Products/Debug-iphoneos/App.app`. Team and device identifiers are passed only locally and are never committed. Install with `xcrun devicectl device install app --device <device-id> .build/ios-device/Build/Products/Debug-iphoneos/App.app`.

### macOS

The build output is `.build/macos/Open Muse.app`, which opens directly without a separate server terminal. The native AppKit/WKWebView shell embeds the server and listens only on a random loopback port.

Local data is stored in the user's `Library/Application Support/Open Muse/`. Build artifacts contain no personal credentials or existing tasks. This is currently a local-architecture development build for macOS 14+, not yet notarized or configured for automatic updates.

### Android

The Capacitor project and platform resources are retained. There are currently no Android build or device acceptance results.

## Features and permissions

- Mobile navigation includes conversations, activity, inspiration, goals, and library; settings, all conversations, and MA Studio live in the sidebar.
- Goals support steps, status, and conversation links; pausing a goal does not stop a running session. Goals do not run on an automatic schedule.
- The library saves real agent replies, with source viewing and export. Activity comes from sessions; inspiration uses preset suggestions.
- MA Studio provides 52 adapted operations covering agents, environments, sessions, memory, connections, skills, and files. Advanced management is collapsed by default, write operations require confirmation, and deletion requires verifying the target ID.

Conversations receive events via SSE, backfilling history on subscribe, reconnect, and foreground restore, with deduplication by event ID. Write requests are not automatically retried; after a timeout, check history for the result first.

When the app creates an agent, it sets `tools[].default_config.permission_policy.type` to `always_allow`, so MA executes tools directly without per-call client approval. Tool calls may send data to external services, perform writes or deletions, and incur costs. The environment's `config.networking.type=unrestricted` controls outbound network access only and is separate from tool permissions.

For existing agents, permissions and the app's default prompt are synced when preparing the workspace or creating a new task. Only agents marked by this app are modified; custom prompts, other tool configurations, and explicit deny policies are preserved, and no replacement resources are created. Old sessions may retain a snapshot of the previous permissions, so creating a new task is recommended. Confirmations for advanced management operations are unaffected.

When old sessions or custom tools still produce pending-approval events, the legacy compatibility flow applies: only the built-in `web_search` and `web_fetch` are auto-approved; everything else requires manual confirmation. Auto-approval preserves submission status and audit records; when the result is unclear, the manual path is restored rather than blindly re-approving. This compatibility flow relies on the task page being open and is not a background scheduling service.

[MA integration coverage](docs/ma-coverage.md) describes the adaptation scope and limitations. [MuseAI-Skills assessment](docs/skills.md) describes the dependencies and licensing boundaries required for skills.

The minimal [cloud environment toolbox](docs/environment-toolbox.md) adds Chrome/CDP and Lark CLI with official skills through an observable background setup script. Other tools are installed only when a task needs them. The agent receives a tool guide and checks readiness before using the installed software.

## Deployment and security boundaries

This project is intended for personal local use or a controlled single-user deployment, not a publicly operated multi-tenant service. For remote deployment, configure at minimum:

```dotenv
HOST=0.0.0.0
MUSE_ACCESS_TOKEN=set-a-random-token-of-at-least-24-characters
MUSE_ALLOWED_ORIGINS=https://your-web-domain,capacitor://localhost,https://localhost
```

Use an HTTPS reverse proxy and disable SSE buffering. The app access token protects the entire BFF; it is not an Ark API key and is not a public registration system.

Ark credentials use AES-256-GCM, with ciphertext and key files at `0600` permissions; both are stored on the same machine and cannot protect against an attacker who already has file access as that user. SQLite stores resource mappings, not raw API keys; tasks and saved items are plaintext JSON. The data directory and backups must be protected.

When there is no login session, the configured default workspace is used; do not treat a shared access token as strict tenant isolation. The current storage is suited to a single process; public deployment still requires rate limiting, auditing, backups, and data retention policies.

## Verification and development

Automated tests and real MA conversations, web tools, saved items, and restart recovery on the iOS simulator have passed. See the [verification record](docs/verification.md) for detailed results and uncovered areas.

For commit conventions, see [CONTRIBUTING](CONTRIBUTING.md); for third-party license notices, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

```text
src/         UI and client adaptation
shared/      Event types, approval policies, and the API catalog
server/      OAuth, encrypted credentials, Ark adaptation, and BFF
ios/         iOS project
macos/       macOS native shell
android/     Android project
tests/       Unit, API, and frontend tests
scripts/     Build and resource generation
docs/        Integration notes and verification records
.build/      Local build and test artifacts, not committed
.data/       Local data and credentials, not committed
```
