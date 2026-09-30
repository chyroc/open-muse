import { t } from "../../shared/i18n";

export type Appearance = "light" | "dark" | "system";
export const appearances: { id: Appearance; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];
const storageKey = "muse.appearance";

// A device-local presentation choice: no credential, no cloud record, and no
// identity scope. An unreadable or unknown value falls back to the system.
export function storedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark() {
  return Boolean(
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
}

export function resolveAppearance(choice: Appearance) {
  return choice === "system"
    ? systemPrefersDark()
      ? "dark"
      : "light"
    : choice;
}

// The native shell owns the window chrome, so it is told the choice itself and
// decides between following macOS and forcing one appearance.
function notifyNative(choice: Appearance) {
  const bridge = (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow;
  try {
    bridge?.postMessage({ name: "appearance", value: choice });
  } catch {
    // A closing window must not break the preference itself.
  }
}

export function applyAppearance(choice: Appearance, native = true) {
  const resolved = resolveAppearance(choice);
  document.documentElement.dataset.appearance = resolved;
  if (native) notifyNative(choice);
  return resolved;
}

export function saveAppearance(choice: Appearance) {
  try {
    if (choice === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, choice);
  } catch {
    // Presentation must still change for this session without storage.
  }
  return applyAppearance(choice);
}

// Both windows and the system itself can change the resolved appearance, so the
// listeners stay for the lifetime of the page and re-read the stored choice.
export function initializeAppearance() {
  applyAppearance(storedAppearance());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const follow = () => {
    if (storedAppearance() === "system") applyAppearance("system", false);
  };
  media?.addEventListener?.("change", follow);
  window.addEventListener("muse-appearance-changed", () =>
    applyAppearance(storedAppearance(), false),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) applyAppearance(storedAppearance(), false);
  });
}

export function appearanceLabel(id: Appearance) {
  return t(appearances.find((item) => item.id === id)!.label);
}
