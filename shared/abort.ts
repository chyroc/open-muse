// Older WebViews have AbortController but not AbortSignal.any/timeout.
// Always release listeners and timers after the entire response is consumed.
export function boundedSignal(
  parents: Array<AbortSignal | null | undefined>,
  milliseconds?: number,
) {
  const controller = new AbortController();
  // A parent's reason is passed on; running out of time is a TimeoutError, so
  // callers can tell a slow request from one they cancelled themselves.
  const follow = (parent: AbortSignal) => () => controller.abort(parent.reason);
  const listeners = parents.map((parent) => {
    const abort = parent ? follow(parent) : () => {};
    if (parent?.aborted) abort();
    else parent?.addEventListener("abort", abort, { once: true });
    return abort;
  });
  const timer =
    milliseconds === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new DOMException("The request timed out.", "TimeoutError"),
            ),
          milliseconds,
        );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parents.forEach((parent, index) =>
        parent?.removeEventListener("abort", listeners[index]),
      );
    },
  };
}
