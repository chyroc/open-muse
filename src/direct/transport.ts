import { t } from "../../shared/i18n";
import { maProvider } from "../../shared/ma-provider";
// The Managed Agents backend chosen at build time; Volcano Ark by default.
export const MA = maProvider(import.meta.env.VITE_MUSE_MA_PROVIDER);
export const MA_BASE_URL = MA.baseUrl;
const origins = new Set([MA.origin]);

// All production network traffic goes directly to the public MA endpoints.
// No proxy, service URL, app access token, or localhost fallback is accepted.
export const directFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (!origins.has(url.origin) || url.username || url.password)
    throw new Error(t("This is not an allowed Volcano API endpoint."));
  try {
    return await fetch(input, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(
      t(
        "Couldn't reach Volcano directly. Check your network; the endpoint must allow this app's origin (CORS). No request is retried automatically.",
      ),
    );
  }
};
