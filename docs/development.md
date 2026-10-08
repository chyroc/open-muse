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
npm run macos:build   # .build/macos/Open Muse.app, a Muse-account build
npm run ios:build     # iOS Simulator app
npm run ios:install   # Muse-account build, signed and installed on a paired iPhone
npm run ios:testflight # Muse-account Release build, uploaded to TestFlight
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
Every app build is an account build; there is no single-user mode. A build
without these values cannot connect and says so in Settings. See
[Open Muse accounts](how-it-works.md#open-muse-accounts) for what an account
does.

`VITE_MUSE_MA_PROVIDER` selects the Managed Agents backend: `ark` (default) or
`claude`. It sets the API the apps call and the origin their connection policy
allows; an account build's service needs the same `MA_PROVIDER`.

`npm run ios:install` produces such a build for a paired iPhone in one step. It
takes the three values from the environment, or reads them with the Volcengine
CLI from the Supabase workspace named `open-muse` (override with
`OPEN_MUSE_SUPABASE_WORKSPACE`), checks the service's `/health`, signs with the
Apple Development team, installs, and launches the app. `OPEN_MUSE_DEVICE`
selects a device when several are paired.

`npm run ios:testflight` archives the same kind of build in Release and uploads
it to App Store Connect for TestFlight. It needs an App Store Connect API key
(`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, or `~/.appstoreconnect/asc_key.json`),
the team's Apple Distribution identity in the login keychain, and an existing
app record for `app.openmuse.mobile`. It recreates the App Store provisioning
profile through the API on every run, so the key needs only the App Manager role,
and numbers the build `yyyymmddHHMM` unless a build number is passed after `--`.

`npm run macos:build` and `npm run ios:build` (the Simulator app) make such a
build the same way: they take the three values from the environment or read
them with the Volcengine CLI like `ios:install`, so both apps sign in with an
Open Muse account's email and password.

The Open Muse service itself is documented in [server/README](../server/README.md).

## Native projects

**iOS:** `ios/App/App.xcodeproj`, scheme `App`, bundle ID
`app.openmuse.mobile`. Run `npm run ios` to open Xcode. The app needs only
internet access and the Open Muse service, not a reachable Mac. Simulator builds use ad-hoc
signing for Keychain access. Physical-device builds require a local development
identity and provisioning profile; keep team/device identifiers untracked.
A free Apple Developer team allows only three installed development apps per
device and has no push entitlement, so the iPhone app cannot receive remote
notifications.

**macOS:** the AppKit/WKWebView shell loads bundled assets through `muse://app/`.
The package contains no Node executable or server bundle and opens no listening
port. The build targets macOS 14+; everyday builds are signed for development
only and not notarized (see Mac releases below).

**Android:** the Capacitor app answers the same
`window.webkit.messageHandlers` contract as the iPhone app through a native
bridge (`android/app/src/main/java/app/openmuse/mobile/`), so the web layer
needs no Android branches for native features. `npm run android:install`
builds an account build with the same three values as the iPhone install and
installs it on the phone connected with USB debugging (set `OPEN_MUSE_DEVICE`
to its adb serial when several are connected). It needs a JDK 21 or newer and
Android SDK 36; `npm run android` opens the project in Android Studio. The
WebView serves the app from `https://localhost`, which the Open Muse service
must allow (see `server/DEPLOY.md`).

## Project layout

```text
src/                  UI and the direct, device-local application runtime
shared/               Ark/OAuth adapters, signing, API catalog, tool payloads
ios/                  iOS shell and UI tests
macos/                Serverless macOS shell
android/              Android shell and native bridge
tests/                Direct-client, protocol, UI, and migration tests
tests/legacy-server/  Test-only migration harness; never shipped or started
scripts/              Builds and asset generation
site/                 The getopenmuse.com website
.build/               Ignored local builds and test artifacts
```

## Website

`site/` holds the public website at [getopenmuse.com](https://getopenmuse.com):
static pages in `site/public` (an English home page, a Chinese one under
`/zh/`, and bilingual privacy and support pages). `node site/build.mjs` builds
two copies with the README screenshots from `docs/images` (as WebP), the app
icons, and the current Android release from `site/downloads.json`:

- `.build/site`, served by Cloudflare behind `site/worker.js`. Cloudflare is
  slow to reach from mainland China, so the Worker sends visitors there to the
  mirror (`?mirror=global` keeps someone on the main site), and
  `/download/android` sends each visitor to the nearer copy of the APK.
- `.build/site-cn`, the mirror at `cn.getopenmuse.com`: Alibaba Cloud OSS in
  Hong Kong behind Alibaba Cloud CDN limited to nodes outside mainland China,
  which needs no ICP filing. It links its APK directly and points search
  engines at the main site.

`site/mirrors.json` names both download mirrors: the mirror bucket's
`android/` and `macos/` folders for mainland China and the Cloudflare R2 bucket at
`download.getopenmuse.com` everywhere else. Mainland object storage refuses to
serve APKs from its default domains, which is why both go through a domain of
the site's own.

```bash
ALIYUN_PROFILE=<profile> CLOUDFLARE_ACCOUNT_ID=<account> \
CLOUDFLARE_API_TOKEN=<token> node site/deploy.mjs
```

The deploy uploads the mirror to OSS, refreshes the CDN, and deploys the
Worker. The build reads the repository's star count from GitHub for the Star
buttons (set `GITHUB_TOKEN` to avoid GitHub's anonymous rate limit); when it
cannot, the buttons show no count. The mirror's HTTPS certificate comes from Let's Encrypt and lasts 90
days: `node site/cn-certificate.mjs` (with `lego` installed and a token that
may edit the zone's DNS) issues or renews it and installs it on the CDN; run
it at least every two months.

Keep its claims in step with the READMEs, and replace a README screenshot
rather than adding one for the site.

## Mac releases

`npm run macos:release` builds the current commit, cloned into
`.build/macos-release/`, as a universal (Apple silicon and Intel) account
build whose build number is the number of commits on the branch. It signs the
app with Developer ID under the hardened runtime, with the entitlements in
`macos/OpenMuse.entitlements`, notarizes and staples it, and packs it in a
signed, notarized disk image in `.build/macos/`. It needs the Developer ID
Application identity as a `.p12` in `OPEN_MUSE_MAC_P12` with its password in
`OPEN_MUSE_MAC_P12_PASSWORD`, imported only into a keychain made for the run,
and an App Store Connect API key in `ASC_KEY_ID`, `ASC_ISSUER_ID`, and
`ASC_KEY_PATH` for notarization. `-- --publish` uploads the image to both
mirrors and records it in `site/downloads.json`, as for Android.

## Android releases

`npm run android:release` builds the signed release of the current commit,
cloned into `.build/android-release/`, as an account build, and writes the
APK to `.build/android/`. The version code is the number of commits on the
branch, so each release installs over the one before. It needs the release
keystore in `OPEN_MUSE_ANDROID_KEYSTORE` (alias `openmuse`) and its password in
`OPEN_MUSE_ANDROID_KEYSTORE_PASSWORD`; the key never enters the repository,
and losing it means existing installs can no longer be updated.

`npm run android:release -- --publish` also uploads the APK to both mirrors,
checks them, and records it in `site/downloads.json`. Commit that file and
deploy the website to offer the new release.

## Checking a commit in isolation

The worktree is often shared by several sessions, so a run there can include
someone else's uncommitted changes. To check one commit on its own, export it
into a temporary directory and link the installed dependencies, including the
Mac app's own:

```bash
dir=$(mktemp -d)
git archive HEAD | tar -x -C "$dir"
ln -s "$PWD/node_modules" "$dir/node_modules"
ln -s "$PWD/macos/node_modules" "$dir/macos/node_modules"
(cd "$dir" && npm run check && npm run build)
```

Without the `macos/node_modules` link the Mac tests report no tests and exit
with an error. Native builds write into the snapshot's own `.build/`.

## Troubleshooting native builds

- Swift packages are fetched over HTTPS. A global Git rule that rewrites
  `https://github.com/` to SSH makes an unattended build fail on host key
  checks; run the build with `GIT_CONFIG_GLOBAL=/dev/null`.
- Granting Screen Recording in System Settings quits every running Open Muse
  instance. That is macOS, not a crash.
- A covered WKWebView window renders white in a window capture; bring it to
  the front first. A window that is not key takes the first click only to
  activate.
- `npm run macos:build` replaces `.build/macos/Open Muse.app` and removes the
  copies earlier builds parked in `.build/macos/direct-build-*`. A copy that is
  still running is kept but unregistered from LaunchServices, so the bundle ID
  resolves to the new build.

## Verification and notices

See [verification](verification.md) for what has been checked on each platform,
[MA coverage](ma-coverage.md) for the Studio operations, the
[environment toolbox](environment-toolbox.md) for the cloud sandbox setup, and
[third-party notices](../THIRD_PARTY_NOTICES.md).
