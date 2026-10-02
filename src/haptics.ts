// System haptics on iOS; a no-op wherever the native bridge is absent.
export type Haptic = "selection" | "light" | "medium" | "success";

export function haptic(kind: Haptic) {
  (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          museHaptics?: { postMessage: (body: string) => void };
        };
      };
    }
  ).webkit?.messageHandlers?.museHaptics?.postMessage(kind);
}
