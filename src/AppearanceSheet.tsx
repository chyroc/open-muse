import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { t } from "../shared/i18n";
import {
  appearanceModes,
  avatarSizes,
  chatThemeColors,
  chatThemes,
  modeSupported,
  readAppearance,
  saveAppearance,
  type AvatarSize,
  type ChatTheme,
} from "./appearance";
import { CompanionAvatar } from "./ChatUI";
import { Sheet } from "./MusePages";
import "./appearance-sheet.css";

const themeNames: Record<ChatTheme, string> = {
  avatar: "Match your companion",
  sky: "Sky",
  black: "Black",
  sand: "Sand",
  blue: "Blue",
  lilac: "Lilac",
  pink: "Pink",
  peach: "Peach",
  lime: "Lime",
};
const sizeNames: Record<AvatarSize, string> = {
  hidden: "Hidden",
  xl: "Extra large",
  large: "Large",
  medium: "Medium",
  small: "Small",
};
const modeNames = { system: "System", light: "Light", dark: "Dark" } as const;

// Settings > Appearance: a small chat preview over the person's bubble color,
// the companion's size atop the chat, and light or dark mode. Every change
// applies at once, to the preview and to the app behind the sheet.
export function AppearanceSheet({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const [appearance, setAppearance] = useState(readAppearance);
  const change = (next: Parameters<typeof saveAppearance>[0]) =>
    setAppearance(saveAppearance(next));
  return (
    <Sheet title={t("Appearance")} onClose={onClose} grouped>
      <div className="appearance-preview" aria-hidden="true">
        <div className="appearance-phone">
          <div className="appearance-header">
            {appearance.size !== "hidden" && (
              <span
                className="appearance-avatar"
                style={{ zoom: avatarSizes[appearance.size] / 136 }}
              >
                <CompanionAvatar />
              </span>
            )}
            <span className="appearance-name">{name}</span>
          </div>
          <span className="appearance-bubble mine wide" />
          <span className="appearance-line" />
          <span className="appearance-bubble mine" />
          <span className="appearance-card" />
        </div>
      </div>
      <h3 className="appearance-heading">{t("Chat theme")}</h3>
      <div
        className="appearance-themes"
        role="radiogroup"
        aria-label={t("Chat theme")}
      >
        {chatThemes.map((theme) => (
          <button
            key={theme}
            role="radio"
            aria-checked={appearance.theme === theme}
            aria-label={t(themeNames[theme])}
            className="appearance-swatch"
            data-theme={theme}
            style={
              theme === "avatar"
                ? undefined
                : {
                    background: chatThemeColors[theme],
                    color: chatThemeColors[theme],
                  }
            }
            onClick={() => change({ theme })}
          >
            {theme === "avatar" && <CompanionAvatar />}
          </button>
        ))}
      </div>
      <h3 className="appearance-heading">{t("Avatar size")}</h3>
      <ul className="settings-list">
        <li>
          <label className="settings-list-row appearance-size">
            <span>{t(sizeNames[appearance.size])}</span>
            <ChevronsUpDown size={18} aria-hidden="true" />
            <select
              aria-label={t("Avatar size")}
              value={appearance.size}
              onChange={(event) =>
                change({ size: event.target.value as AvatarSize })
              }
            >
              {(Object.keys(avatarSizes) as AvatarSize[]).map((size) => (
                <option key={size} value={size}>
                  {t(sizeNames[size])}
                </option>
              ))}
            </select>
          </label>
        </li>
      </ul>
      {modeSupported() && (
        <>
          <h3 className="appearance-heading">{t("Mode")}</h3>
          <ul className="settings-list" role="radiogroup">
            {appearanceModes.map((mode) => (
              <li key={mode}>
                <button
                  className="settings-list-row"
                  role="radio"
                  aria-checked={appearance.mode === mode}
                  onClick={() => change({ mode })}
                >
                  <span>{t(modeNames[mode])}</span>
                  {appearance.mode === mode && (
                    <Check size={18} className="settings-check" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
