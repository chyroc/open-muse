import { zhCN } from "./locales/zh-CN";

export type Language = "en" | "zh-CN";

/** Match the first supported system preference, with English as the fallback. */
export function resolveLanguage(languages: readonly string[]): Language {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}

// The device's own preference list, resolved to a supported language.
export function deviceLanguage(): Language {
  const native = (
    globalThis as typeof globalThis & {
      __OPEN_MUSE_LANGUAGES__?: string[];
    }
  ).__OPEN_MUSE_LANGUAGES__;
  return resolveLanguage(
    native ??
      (typeof navigator === "undefined" || !navigator
        ? []
        : navigator.languages?.length
          ? navigator.languages
          : [navigator.language]),
  );
}

// A person may pick the app language on this device. Without a choice the app
// follows the device list; nothing is stored until someone picks a language.
export type LanguageChoice = "system" | Language;
const choiceKey = "open-muse.language";
export function languageChoice(): LanguageChoice {
  try {
    const value = globalThis.localStorage?.getItem(choiceKey);
    return value === "en" || value === "zh-CN" ? value : "system";
  } catch {
    return "system";
  }
}
export function setLanguageChoice(choice: LanguageChoice) {
  if (choice === "system") globalThis.localStorage?.removeItem(choiceKey);
  else globalThis.localStorage?.setItem(choiceKey, choice);
}

// The language the app shows: the person's choice, else the device's.
export function systemLanguage(): Language {
  const choice = languageChoice();
  return choice === "system" ? deviceLanguage() : choice;
}

export function formatLocale() {
  return systemLanguage() === "zh-CN" ? "zh-CN" : "en-US";
}

/** Translate authored UI copy only. Never pass user content or protocol values. */
export function t(
  message: string,
  values: Record<string, string | number> = {},
  language = systemLanguage(),
): string {
  const template =
    language === "zh-CN" && Object.hasOwn(zhCN, message)
      ? zhCN[message]
      : message;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function initializeLanguage() {
  document.documentElement.lang = systemLanguage();
}
