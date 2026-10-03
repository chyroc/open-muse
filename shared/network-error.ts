// WebKit and other browsers report a request that never reached the server
// as a TypeError with a terse, untranslated message such as "Load failed".
export function isNetworkFailure(error: unknown) {
  return (
    error instanceof TypeError &&
    /load failed|failed to fetch|networkerror|network connection|internet connection/i.test(
      error.message,
    )
  );
}
