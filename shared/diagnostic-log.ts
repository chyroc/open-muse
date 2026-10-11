// Recent failed requests, kept on this device for a problem report: when,
// which request (its IDs and query left out), the HTTP status, the backend's
// error code, and its request ID. Never message text, keys, account or
// resource IDs, or anything a person wrote; every field is checked against a
// narrow pattern before it is kept, and anything else is dropped.
export type FailedRequest = {
  at: number;
  // "ark" for a call to the model service, "service" for the Open Muse service.
  via: "ark" | "service";
  // "POST /agents" or "GET /sessions/:id/events".
  request: string;
  // 0 when no answer came back.
  status: number;
  code?: string;
  requestId?: string;
  // What the service reported about its own call to the model service.
  detail?: string;
};

const storageKey = "open-muse:failed-requests:v1";
const limit = 20;
const patterns = {
  request: /^(GET|POST|PUT|PATCH|DELETE) \/[\w./:-]{0,110}$/,
  code: /^[A-Za-z][\w.-]{0,90}$/,
  requestId: /^[\w-]{8,100}$/,
  detail: /^[\w .:;/()-]{1,300}$/,
};

function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function clean(entry: Partial<FailedRequest>): FailedRequest | undefined {
  if (
    typeof entry.at !== "number" ||
    !Number.isFinite(entry.at) ||
    (entry.via !== "ark" && entry.via !== "service") ||
    typeof entry.request !== "string" ||
    !patterns.request.test(entry.request) ||
    !Number.isInteger(entry.status) ||
    (entry.status as number) < 0 ||
    (entry.status as number) > 599
  )
    return;
  const kept: FailedRequest = {
    at: entry.at,
    via: entry.via,
    request: entry.request,
    status: entry.status as number,
  };
  for (const field of ["code", "requestId", "detail"] as const)
    if (
      typeof entry[field] === "string" &&
      patterns[field].test(entry[field] as string)
    )
      kept[field] = entry[field];
  return kept;
}

export function recentFailures(): FailedRequest[] {
  try {
    const list = JSON.parse(storage()?.getItem(storageKey) ?? "[]");
    return Array.isArray(list)
      ? list.flatMap((entry) => clean(entry) ?? []).slice(-limit)
      : [];
  } catch {
    return [];
  }
}

// Kept only where the device has local storage (the apps); a no-op on the
// service.
export function recordFailure(
  entry: Omit<FailedRequest, "at">,
  at = Date.now(),
) {
  const store = storage();
  const kept = clean({ ...entry, at });
  if (!store || !kept) return;
  try {
    store.setItem(
      storageKey,
      JSON.stringify([...recentFailures(), kept].slice(-limit)),
    );
  } catch {
    /* A full or unavailable storage only loses the record. */
  }
}

// One line per failure, newest last, for the diagnostics a person copies.
export function failureLines(entries = recentFailures()) {
  return entries.map((entry) =>
    [
      new Date(entry.at).toISOString().slice(0, 19) + "Z",
      entry.via,
      entry.request,
      entry.status ? `HTTP ${entry.status}` : "no answer",
      ...(entry.code ? [entry.code] : []),
      ...(entry.requestId ? [`request ${entry.requestId}`] : []),
      ...(entry.detail ? [`(${entry.detail})`] : []),
    ].join(" "),
  );
}
