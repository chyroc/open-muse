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

// A read that ran in the background and failed only because the connection
// did: no answer, no answer in time, or cut off before the answer arrived, as
// when the system suspends the app. Such a read is tried again quietly; only
// a request the person made, such as sending a message, reports it.
export function isTransientFailure(error: unknown) {
  return (
    isNetworkFailure(error) ||
    (error instanceof Error && error.name === "AbortError")
  );
}
