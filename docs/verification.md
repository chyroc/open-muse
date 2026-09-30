# Verification record

Verification date: 2026-09-30. Mocked-upstream regression tests are distinguished from real cloud tests. No personal credentials, accounts, resource IDs, or raw logs are included.

## Automated checks

- TypeScript checks pass; 12 test files and 216 tests pass.
- Coverage includes SSO, API key login, encrypted storage, identity isolation, SQLite auto-configuration, API adaptation, SSE, approvals, goals, and the library. Signed-out requests cannot create conversations or read legacy simulated history; upstream failures never produce replacement replies.
- Frontend production build and iOS Simulator build pass.
- The macOS native shell has completed local build and window interaction verification; the development build is not yet notarized.

## Real MA on iOS

Environment: iPhone 17 Pro, iOS 26.5 simulator. The existing API-key login was restored from Keychain to connect to the real Ark data plane. Native end-to-end verification passes:

1. An unconfigured service presents SSO/API-key connection options, disables conversation submission, and displays no simulated replies.
2. The real account reuses its existing workspace; two rounds of computation returned `42` and `84`, with the second round correctly restoring context.
3. Saving a reply and viewing it in the library; after terminating and relaunching the app, login and the source conversation were restored.

Earlier real verification also covered `web_fetch` reading a public example page and returning its title, with the execution record retaining the auto-approval result. That tool case was not rerun for this change.

Repeated logins with the same connection reuse one set of workspace mappings. The tests did not send email, make purchases, or delete cloud resources.

A restart failure caused by temporary iOS login storage was found and fixed; sessions now use Keychain isolated by server address. Simulator builds enable ad-hoc signing to avoid Keychain permission errors; when secure storage fails, a retry entry is retained rather than falling back to an anonymous workspace.

## How to reproduce

```bash
npm ci
npm run check
npm run build
npm run ios:build
```

`ios/App/MuseUITests/MuseUITests.swift` contains a default signed-out connection test and live cases explicitly enabled via the `MUSE_LIVE_TESTS` compilation condition. Live cases incur cloud calls and must not be the default for CI without credentials. Application runtime paths never generate simulated replies; mocked responses are confined to test fixtures.

The signed-out test requires an unconfigured server listening on `4312`; live cases require a standalone server listening on `4313`, a logged-out app, and a test key provided via the simulator clipboard. Do not put keys in source code, command arguments, or launch environment. Clear the clipboard afterward; result bundles and screenshots stay only in ignored local test directories.

## Not covered

- Physical iPhone installation and signing, Android builds, and device interaction.
- The full real SSO authorization flow was not re-run this round; SSO compatibility is covered by automated tests, supplemented by earlier real macOS conversation records.
- Real-account permissions for all 52 MA operations, full MCP OAuth, real skills, and file uploads.
- Multi-tenant public deployment, concurrent performance, a full security audit, and app store release.
