# Background Feed service

Optional Cloudflare Workers API for the iOS and macOS apps. No website, static
assets, chat proxy, or native app binaries are hosted here. Direct Ark usage
remains independent of this service.

## Current scope

The private-service foundation includes a health endpoint, authenticated status,
explicit origin allowlisting, and D1 migrations for schedules, durable runs,
and Feed items. Background execution and native integration are the next slices;
they are not enabled by this foundation.

This is a single-owner private deployment, not a public registration service.
Each authorized device uses a different random token. Only SHA-256 token hashes
are configured on the server; all tokens map to the deployment's `OWNER_ID`.
Never use an Ark API key or Cloudflare API token as a device token.

## Local development

Install root dependencies first, then run from this directory:

```sh
npm ci
npm run db:local
npm run check
npm run build
npm run dev
```

`build` bundles the Worker with Wrangler's dry-run mode. It does not deploy or
create cloud resources. Tests run against a local Miniflare D1 database with
mocked upstream calls. Development listens on port 4311.

Configure local bindings in ignored `.dev.vars`:

- `DEVICE_TOKEN_HASHES`: a JSON object from SHA-256 device-token hashes to labels.
  Missing or malformed configuration disables authenticated endpoints.
- `ALLOWED_ORIGINS`: comma-separated exact origins for the native WebViews,
  typically `capacitor://localhost,muse://app`. Verify the actual app origins.
  Requests with no Origin still require authentication. Opaque `null` origins
  and non-allowlisted origins are rejected.

Store device tokens in native Keychain. Remove a hash to revoke that device.
Never put tokens in tracked config, URLs, screenshots, logs, or build variables.

## API

- `GET /health`: public liveness only; no configuration or credentials.
- `GET /v1/status`: requires `Authorization: Bearer <device-token>`; checks D1.

Responses use `Cache-Control: no-store`. There is no wildcard CORS and no
cookie-based authentication. Origin checks do not replace token authentication.

## Deployment boundary

The checked-in Wrangler database ID is a non-deployable placeholder. Create an
app-specific D1 database and use ignored `wrangler.local.jsonc` for actual
resource IDs. Apply migrations before deploying. Configure device-token hashes
with Worker secrets rather than committing them. Cloudflare management tokens
belong only in local tooling, never in Worker bindings or an app bundle.

No cloud deployment, real MA call, or notification delivery is established by a
passing local build. Do not enable scheduled generation until the dedicated MA
configuration, limits, and access policy have been verified.

See [design boundaries](DESIGN.md) for authorization, uncertain-write recovery,
data residency, and later sync/notification work.
