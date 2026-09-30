// This is public build configuration, never a credential or an upstream proxy.
export function backgroundOrigin(value: string | undefined): string {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "VITE_MUSE_BACKGROUND_URL must be an HTTPS origin without a path, credentials, query, or fragment.",
    );
  return url.origin;
}
