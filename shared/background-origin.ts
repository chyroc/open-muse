// This is public build configuration, never a credential or an upstream proxy.
// The service's base URL: an HTTPS origin, optionally with a path such as a
// Supabase function's `/functions/v1/open-muse`. Requests go to base + "/v1/…".
export function backgroundOrigin(value: string | undefined): string {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "VITE_MUSE_BACKGROUND_URL must be an HTTPS URL without credentials, query, or fragment.",
    );
  return url.origin + url.pathname.replace(/\/+$/, "");
}

// The connection-policy source for a base URL. A CSP source with a path would
// match only that exact path, so the policy names the origin.
export function backgroundConnectSource(base: string) {
  return base ? new URL(base).origin : "";
}
