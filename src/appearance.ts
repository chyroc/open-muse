// Settings > Appearance: the color of the person's own chat bubbles, how
// large the companion sits atop the chat, and light or dark mode. These are
// preferences of this device, kept in local storage and applied to the root
// element before the app draws. Light and dark mode go through the iPhone
// app, which overrides the window's appearance so the whole app follows.

export const chatThemes = [
  "avatar",
  "sky",
  "black",
  "sand",
  "blue",
  "lilac",
  "pink",
  "peach",
  "lime",
] as const;
export type ChatTheme = (typeof chatThemes)[number];
// The swatch shown for each theme; "avatar" shows the companion instead.
export const chatThemeColors: Record<Exclude<ChatTheme, "avatar">, string> = {
  sky: "#d0e4fc",
  black: "#000000",
  sand: "#e2dbd3",
  blue: "#bfdafb",
  lilac: "#d7c7ee",
  pink: "#f3bddd",
  peach: "#f9dabc",
  lime: "#e3efcb",
};

// The companion's height atop the chat, in points.
export const avatarSizes = {
  hidden: 0,
  xl: 80,
  large: 68,
  medium: 56,
  small: 44,
} as const;
export type AvatarSize = keyof typeof avatarSizes;

export const appearanceModes = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof appearanceModes)[number];

export type Appearance = {
  theme: ChatTheme;
  size: AvatarSize;
  mode: AppearanceMode;
};

const key = "open-muse.appearance";
const defaults: Appearance = { theme: "avatar", size: "large", mode: "system" };

type NativeAppearance = { postMessage: (mode: string) => void };
const native = () =>
  (
    globalThis as unknown as {
      webkit?: { messageHandlers?: { museAppearance?: NativeAppearance } };
    }
  ).webkit?.messageHandlers?.museAppearance;

// Light and dark mode can be chosen only in the iPhone app.
export const modeSupported = () => Boolean(native());

export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(
      globalThis.localStorage?.getItem(key) ?? "{}",
    ) as Partial<Appearance>;
    return {
      theme: chatThemes.includes(saved.theme as ChatTheme)
        ? (saved.theme as ChatTheme)
        : defaults.theme,
      size:
        typeof saved.size === "string" && saved.size in avatarSizes
          ? saved.size
          : defaults.size,
      mode: appearanceModes.includes(saved.mode as AppearanceMode)
        ? (saved.mode as AppearanceMode)
        : defaults.mode,
    };
  } catch {
    return { ...defaults };
  }
}

export function applyAppearance(appearance = readAppearance()) {
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.chatTheme = appearance.theme;
    root.dataset.avatarSize = appearance.size;
    root.style.setProperty(
      "--companion-zoom",
      String(avatarSizes[appearance.size] / avatarSizes.large),
    );
  }
  native()?.postMessage(appearance.mode);
}

export function saveAppearance(change: Partial<Appearance>) {
  const next = { ...readAppearance(), ...change };
  const isDefault =
    next.theme === defaults.theme &&
    next.size === defaults.size &&
    next.mode === defaults.mode;
  if (isDefault) globalThis.localStorage?.removeItem(key);
  else globalThis.localStorage?.setItem(key, JSON.stringify(next));
  applyAppearance(next);
  return next;
}
