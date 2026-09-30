# Verification record

Verification date: 2026-09-30. Mocked-upstream regression tests are distinguished from real cloud tests. No personal credentials, accounts, resource IDs, or raw logs are included.

## Automated checks

- TypeScript checks pass; 12 test files and 277 tests pass, including 73 direct-client cases.
- Direct-client coverage includes API key validation, OAuth PKCE, signing parity with the official SDK, secure-storage adapters, identity-scoped IndexedDB, cloud workspace recovery, ambiguous write protection, SSE, approvals, local goals and saved replies, multipart uploads, and REST operation routing.
- The test-only legacy harness retains protocol and migration regression coverage. It is not shipped or started by the app. Signed-out requests cannot create conversations; upstream failures never produce replacement replies.
- Frontend production, iOS Simulator, and standalone macOS builds pass. Capacitor asset synchronization passes for iOS and Android. The macOS development build is not notarized.

## Real MA on the web

The production assets were served by a static preview server without an application backend. A real API-key login, recovery of the existing cloud workspace, and two conversation turns passed: the second turn recalled the first turn's marker and doubled `42` to `84`. Saving a reply and reloading restored the session and conversation.

Browser request inspection confirmed that MA traffic went directly to the public Ark origin, not a local API service. Login uses a read-only MA agent-list request. The inference `/models` endpoint currently returns invalid CORS headers, so login and workspace preparation do not depend on it. Existing agents keep their model; new agents use the public default documented in the README, subject to actual project access.

## Real MA on iOS

Environment: iPhone 17 Pro, iOS 26.5 simulator. The app loads bundled assets and connects directly to the real Ark data plane. Native end-to-end verification passes:

1. A signed-out app presents SSO/API-key options, disables conversation submission, and displays no simulated replies. Service connection and Advanced setup are absent.
2. The real account reuses its existing workspace; two rounds of computation returned `42` and `84`, with the second round correctly restoring context.
3. Saving a reply and viewing it in the library; after terminating and relaunching the app, login and the source conversation were restored.

Earlier real verification also covered `web_fetch` reading a public example page and returning its title, with the execution record retaining the auto-approval result. That tool case was not rerun for this change.

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

Neither UI test requires a backend or a listening port. Live cases need internet access and a test key supplied via the simulator clipboard when signed out. Do not put keys in source code, command arguments, or launch environment. Clear the clipboard afterward; result bundles and screenshots stay only in ignored local test directories.

## Not covered

- Physical iPhone installation and signing, Android builds, and Android device interaction. The local environment lacks JDK 21 and Android SDK 36; Android asset sync is not a substitute for build/device verification.
- The full real SSO authorization flow was not re-run this round. Automated PKCE, token exchange, signing, and project-selection tests pass; public endpoint CORS preflights were also checked. These checks do not establish a real interactive SSO result.
- Real-account permissions for all 52 MA operations, full MCP OAuth, real skills, and file uploads.
- Multi-tenant public deployment, concurrent performance, a full security audit, and app store release.
