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
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    throw networkError(error, init.signal, unreachable);
  }
  // Reading the body can fail too, as when the system suspends the app while
  // a response arrives; WebKit then reports only "Load failed".
  for (const method of ["json", "text"] as const) {
    const read = response[method].bind(response);
    Object.defineProperty(response, method, {
      value: () =>
        read().catch((error: unknown) => {
          throw networkError(error, init.signal, interrupted);
        }),
    });
  }
  return response;
};

// Ark answers a rejected key without CORS headers, so the app sees that as
// an unreachable server too.
const unreachable = () =>
  t(
    "Couldn't reach Volcano Ark. Check your network and try again. If this keeps happening while other sites load, Ark may have rejected the API key; check it in Settings.",
  );
const interrupted = () =>
  t(
    "The connection to Volcano was interrupted before the response arrived. No request is retried automatically.",
  );

// Network failures keep a recognizable name, so a view that reads in the
// background can try again quietly, and carry readable copy instead of the
// browser's own text such as "Load failed" or "Fetch is aborted". A request
// the caller cancelled keeps its original error.
function networkError(
  error: unknown,
  signal: AbortSignal | null | undefined,
  message: () => string,
) {
  if (signal?.aborted && (signal.reason as Error)?.name !== "TimeoutError")
    return error;
  const timedOut = signal?.aborted;
  const failure = new Error(
    timedOut
      ? t("Volcano did not answer in time. No request is retried automatically.")
      : message(),
  );
  failure.name = timedOut ? "TimeoutError" : "NetworkError";
  return failure;
}
