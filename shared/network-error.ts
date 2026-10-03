// WebKit and other browsers report a request that never reached the server
// as a TypeError with a terse, untranslated message such as "Load failed".
// The direct client already turns those into readable errors named
// NetworkError (no answer) or TimeoutError (no answer in time).
export function isNetworkFailure(error: unknown) {
  if (
    error instanceof Error &&
    ["NetworkError", "TimeoutError"].includes(error.name)
  )
    return true;
  return (
    error instanceof TypeError &&
    /load failed|failed to fetch|networkerror|network connection|internet connection/i.test(
      error.message,
    )
  );
}
