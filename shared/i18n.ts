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

export function systemLanguage(): Language {
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
