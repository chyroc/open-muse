import type { ComponentType, ReactNode } from "react";
import { formatLocale } from "../shared/i18n";

// Drawn app icons for the connectors that stand for an app: what the person
// sees on their Home Screen or in the Dock, redrawn here because an app may
// not read another app's icon. Each fills a square tile and keeps its colors
// in both appearances, as app icons do.
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

function Tile({
  fill = "#fff",
  children,
}: {
  fill?: string;
  children: ReactNode;
}) {
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
      <rect width="40" height="40" rx="9" fill={fill} />
      {children}
    </svg>
  );
}

// Today's weekday in red over today's date, as the calendar icon shows it.
function CalendarIcon({ now = new Date() }: { now?: Date }) {
  const weekday = new Intl.DateTimeFormat(formatLocale(), {
    weekday: "short",
  }).format(now);
  return (
    <Tile>
      <text
        x="20"
        y="12.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="600"
        fill="#ff3b30"
        fontFamily="-apple-system, system-ui, sans-serif"
      >
        {weekday}
      </text>
      <text
        x="20"
        y="32"
        textAnchor="middle"
        fontSize="19"
        fontWeight="300"
        fill="#1c1c1e"
        fontFamily="-apple-system, system-ui, sans-serif"
      >
        {now.getDate()}
      </text>
    </Tile>
  );
}

// Three colored dots, each leading a gray line.
function RemindersIcon() {
  return (
    <Tile>
      {(
        [
          [12, "#ff9500"],
          [20, "#007aff"],
          [28, "#ff3b30"],
        ] as const
      ).map(([y, color]) => (
        <g key={y}>
          <circle cx="11" cy={y} r="2.8" fill={color} />
          <rect
            x="16"
            y={y - 0.75}
            width="15"
            height="1.5"
            rx="0.75"
            fill="#d1d1d6"
          />
        </g>
      ))}
    </Tile>
  );
}

// A gray person on a light page with colored index tabs.
function ContactsIcon() {
  return (
    <Tile fill="#ececf0">
      <circle cx="18.5" cy="16" r="5.5" fill="#8e8e93" />
      <path d="M8.5 31c0-5.5 4.5-8.5 10-8.5s10 3 10 8.5z" fill="#8e8e93" />
      {(["#ff3b30", "#ff9500", "#34c759", "#007aff"] as const).map(
        (color, index) => (
          <rect
            key={color}
            x="35"
            y={8 + index * 6.5}
            width="3"
            height="5"
            rx="1"
            fill={color}
          />
        ),
      )}
    </Tile>
  );
}

// A pink heart on white.
function HealthIcon() {
  return (
    <Tile>
      <defs>
        <linearGradient id="app-icon-health" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b8e" />
          <stop offset="1" stopColor="#ff2d55" />
        </linearGradient>
      </defs>
      <path
        d="M20 30c-.4 0-.7-.1-1-.4-4.8-4-8.5-7.3-8.5-11.4 0-2.8 2.1-4.9 4.8-4.9 1.9 0 3.6 1 4.7 2.7 1.1-1.7 2.8-2.7 4.7-2.7 2.7 0 4.8 2.1 4.8 4.9 0 4.1-3.7 7.4-8.5 11.4-.3.3-.6.4-1 .4z"
        fill="url(#app-icon-health)"
      />
    </Tile>
  );
}

// A blue wing under a teal one, rising to the right.
function LarkIcon() {
  return (
    <Tile>
      <g transform="translate(20 21) scale(1.2) translate(-20 -18)">
        <path
          d="M11 9.5c6 0 11.5 2.7 15 7.5l-6.5 3.2C17.6 15.6 14.6 12 11 9.5z"
          fill="#00d6b9"
        />
        <path
          d="M6.5 17.5c6.5 6.8 15 9.6 23 5.6 1.7-.9 3.3-2.3 4.5-4.1-1.9.9-4 1.2-6 .9-7.3-1.1-14-1.9-21.5-2.4z"
          fill="#3370ff"
        />
        <path
          d="M26 17c2 .8 4.4.9 6.6.3-1.2 1.3-2.8 2.2-4.5 2.4-2.9.4-5.6-.1-8.6-.5z"
          fill="#133c9a"
        />
      </g>
    </Tile>
  );
}

// Red, yellow and green around a blue center ringed in white.
function BrowserIcon() {
  return (
    <Tile>
      <path d="M20 20 7 12.5A15 15 0 0 1 33 12.5z" fill="#ea4335" />
      <path d="M20 20 33 12.5A15 15 0 0 1 20 35z" fill="#fbbc04" />
      <path d="M20 20 20 35A15 15 0 0 1 7 12.5z" fill="#34a853" />
      <circle cx="20" cy="20" r="7" fill="#fff" />
      <circle cx="20" cy="20" r="5.5" fill="#1a73e8" />
    </Tile>
  );
}

// A prompt on a dark tile.
function FilesIcon() {
  return (
    <Tile fill="#1c1c1e">
      <path
        d="m11 14 5 4.5-5 4.5M18.5 25H27"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Tile>
  );
}

export function AppIcon({ id }: { id: AppIconId }) {
  switch (id) {
    case "calendar":
      return <CalendarIcon />;
    case "reminders":
      return <RemindersIcon />;
    case "contacts":
      return <ContactsIcon />;
    case "health":
      return <HealthIcon />;
    case "lark":
      return <LarkIcon />;
    case "browser":
      return <BrowserIcon />;
    case "files":
      return <FilesIcon />;
  }
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
