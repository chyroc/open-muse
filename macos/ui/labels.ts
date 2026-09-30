import { systemLanguage, t } from "../../shared/i18n";

export type NavSection = "chat" | "ideas" | "library";

// The Mac navigation follows the desktop app this client mirrors, which names
// these sections differently in Chinese than the shared mobile wording. Both
// paths go through the catalog: English reads the shared source wording, and
// only the Chinese value is keyed separately, so the other clients keep theirs.
// A new interface language needs its own branch here as well as its catalog.
export function navLabel(section: NavSection) {
  const chinese = systemLanguage() === "zh-CN";
  if (section === "chat") return chinese ? t("Chat tab") : t("Chat");
  if (section === "ideas") return chinese ? t("Ideas tab") : t("Ideas");
  return chinese ? t("Library tab") : t("Library");
}

// Wording the other clients also use, where only the Mac names the feature the
// way the desktop app does. English keeps the shared source string.
export function refreshIdeasLabel() {
  return systemLanguage() === "zh-CN"
    ? t("Refresh the ideas tab")
    : t("Refresh ideas");
}

export function viewIdeaLabel(title: string) {
  return systemLanguage() === "zh-CN"
    ? t("View an idea in the ideas tab: {title}", { title })
    : t("View idea: {title}", { title });
}
