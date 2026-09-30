// Older WebViews have AbortController but not AbortSignal.any/timeout.
// Always release listeners and timers after the entire response is consumed.
export function boundedSignal(
  parents: Array<AbortSignal | null | undefined>,
  milliseconds?: number,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const parent of parents) {
    if (parent?.aborted) abort();
    else parent?.addEventListener("abort", abort, { once: true });
  }
  const timer =
    milliseconds === undefined ? undefined : setTimeout(abort, milliseconds);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      for (const parent of parents) parent?.removeEventListener("abort", abort);
    },
  };
}
