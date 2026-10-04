import type { ComponentType } from "react";

// The official icons of the apps that connectors stand for. An app on iPhone
// cannot read another app's icon, so the app carries them; each keeps its
// colors in both appearances, as app icons do.
const files = import.meta.glob<string>("./assets/apps/*.png", {
  eager: true,
  import: "default",
});

export const appIconIds = [
  "calendar",
  "reminders",
  "contacts",
  "health",
  "lark",
  "browser",
  "files",
] as const;
export type AppIconId = (typeof appIconIds)[number];

export const hasAppIcon = (id: string): id is AppIconId =>
  (appIconIds as readonly string[]).includes(id);

export const appIconSource = (id: AppIconId) =>
  files[`./assets/apps/${id}.png`];

export function AppIcon({ id }: { id: AppIconId }) {
  return (
    <img
      src={appIconSource(id)}
      alt=""
      aria-hidden="true"
      width="100%"
      height="100%"
      draggable={false}
    />
  );
}

// A connector's icon: the app it stands for, otherwise its glyph on a tile.
export function ConnectorIcon({
  id,
  Icon,
  size = 20,
}: {
  id: string;
  Icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }>;
  size?: number;
}) {
  return hasAppIcon(id) ? (
    <span className="connector-icon app-icon" data-id={id} aria-hidden="true">
      <AppIcon id={id} />
    </span>
  ) : (
    <span className="connector-icon" data-id={id}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
