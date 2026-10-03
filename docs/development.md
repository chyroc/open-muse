# Development

How to build, run, and work on Open Muse. For what the app does and how each
part behaves, see [How it works](how-it-works.md). Contribution and commit rules
are in [CONTRIBUTING](../CONTRIBUTING.md).

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
npm run macos:build:account  # The same Mac app as a Muse-account build
npm run ios:build     # iOS Simulator app
npm run ios:install   # Muse-account build, signed and installed on a paired iPhone
npm run native:sync   # Build and sync the iOS and Android bundles
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). Deploy `dist/` to any
trusted HTTPS static host. The static host serves assets only; it never receives
Ark credentials or proxies API requests. Native apps bundle these same assets.
Do not place credentials in build-time environment variables or source files;
the three account build values described below are public.

## Account builds

Account builds set three public values at build time: `VITE_MUSE_BACKGROUND_URL`
(the Open Muse service origin), `VITE_MUSE_SUPABASE_URL` (the Auth origin), and
`VITE_MUSE_SUPABASE_ANON_KEY` (the anon or publishable key; secret and
service-role keys are rejected). Both origins are pinned in the app's CSP.
Builds without these values run in single-user local mode: the API key is kept
on the device and no account or service request is made. See [Open Muse accounts](how-it-works.md#open-muse-accounts)
for what an account does.

`npm run ios:install` produces such a build for a paired iPhone in one step. It
takes the three values from the environment, or reads them with the Volcengine
CLI from the Supabase workspace named `open-muse` (override with
`OPEN_MUSE_SUPABASE_WORKSPACE`), checks the service's `/health`, signs with the
Apple Development team, installs, and launches the app. `OPEN_MUSE_DEVICE`
selects a device when several are paired.

`npm run macos:build:account` builds the Mac app the same way: it resolves the
three values like `ios:install`, checks the service's `/health`, and writes
`.build/macos/Open Muse.app` with email and password sign-in. A plain
`npm run macos:build` without the three values gives the single-user local
mode, which only accepts an Ark API key.

The Open Muse service itself is documented in [server/README](../server/README.md).

## Native projects

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

## Project layout

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

## Verification and notices

See [verification](verification.md) for what has been checked on each platform,
[MA coverage](ma-coverage.md) for the Studio operations, the
[environment toolbox](environment-toolbox.md) for the cloud sandbox setup, and
[third-party notices](../THIRD_PARTY_NOTICES.md).
