import { formatLocale, systemLanguage } from "../../shared/i18n";

export type SettingsSectionId =
  | "general"
  | "connectors"
  | "computer-use"
  | "file-system"
  | "dictation"
  | "wallet"
  | "secure-storage"
  | "permissions"
  | "message-channels"
  | "devices"
  | "data-controls"
  | "help"
  | "legal";

// Sections this Mac build can answer truthfully carry content. The rest keep
// their place in the list and state why they are not connected, so the window
// never implies a capability the app does not have.
export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  connected: boolean;
  unavailable?: string;
};

export const settingsSections: SettingsSection[] = [
  { id: "general", label: "General", connected: true },
  {
    id: "connectors",
    label: "Connectors",
    connected: false,
    unavailable:
      "MCP connectors and their OAuth flows are not wired into this Mac build. Tools stay limited to what your agent already has.",
  },
  { id: "computer-use", label: "Computer use", connected: true },
  {
    id: "file-system",
    label: "File system access",
    connected: false,
    unavailable:
      "Sandbox file browsing is not connected. Library's System files only opens your MA memory documents.",
  },
  { id: "dictation", label: "Dictation", connected: true },
  {
    id: "wallet",
    label: "Wallet",
    connected: false,
    unavailable:
      "This client holds no payment method and performs no billing. Cloud usage is billed by your Ark account.",
  },
  { id: "secure-storage", label: "Secure storage", connected: true },
  { id: "permissions", label: "Permissions", connected: true },
  {
    id: "message-channels",
    label: "Message channels",
    connected: false,
    unavailable:
      "There is no Open Muse service to deliver messages from, so no email, SMS or chat channel can be connected.",
  },
  {
    id: "devices",
    label: "Devices",
    connected: false,
    unavailable:
      "Each client keeps its own local data and credentials, so this Mac cannot list or manage your other devices.",
  },
  { id: "data-controls", label: "Data controls", connected: true },
  { id: "help", label: "Help and support", connected: true },
  { id: "legal", label: "Legal", connected: true },
];

export function settingsSection(id: string | undefined) {
  return (
    settingsSections.find((section) => section.id === id) ?? settingsSections[0]
  );
}

export function isSettingsRoute(hash: string) {
  return /^#?\/settings(\/|$|\?)/.test(hash.trim());
}

export function settingsRouteSection(hash: string) {
  const match = /^#?\/settings\/([a-z-]{1,40})$/.exec(hash.trim());
  return settingsSection(match?.[1]).id;
}

export function settingsPath(id: SettingsSectionId) {
  return `#/settings/${id}`;
}

// The app follows the system preference list and never stores its own override,
// so the window reports the resolved language instead of offering a picker.
export function activeLanguage() {
  const preferred = (window as unknown as { __OPEN_MUSE_LANGUAGES__?: unknown })
    .__OPEN_MUSE_LANGUAGES__;
  return {
    language: systemLanguage(),
    locale: formatLocale(),
    preferred: Array.isArray(preferred)
      ? preferred.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export function appVersion() {
  const version = (window as unknown as { __OPEN_MUSE_VERSION__?: unknown })
    .__OPEN_MUSE_VERSION__;
  return typeof version === "string" && /^[\w.\- ()]{1,40}$/.test(version)
    ? version
    : "";
}

// The native shell owns the separate settings window. Without it, the caller
// falls back to the in-workspace panel instead of losing the entry point.
export function openNativeSettings(section?: SettingsSectionId) {
  const bridge = (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow;
  if (!bridge) return false;
  try {
    bridge.postMessage(
      section ? { name: "settings", value: section } : { name: "settings" },
    );
    return true;
  } catch {
    return false;
  }
}

export type ConnectionStatus = {
  loggedIn: boolean;
  ready: boolean;
  project?: string;
  method?: "api_key";
  legacy?: "sso";
};

export function connectionSummary(status: ConnectionStatus | undefined) {
  return {
    state: !status?.loggedIn
      ? "Not signed in"
      : status.ready
        ? "Connected"
        : "Choose a project",
    method: status?.method === "api_key" ? "API Key" : "",
    project: status?.project ?? "",
  };
}

// The shared sign-in panel signs out as soon as its button is pressed. The Mac
// settings window must confirm first, so it hands that panel a client whose
// sign-out is routed through the window instead of editing shared code.
export function clientWithConfirmedSignOut<T extends object>(
  client: T,
  confirm: () => Promise<boolean>,
): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "auth" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (path: string, body?: object) => {
        if (path === "logout" && !(await confirm())) return { ok: false };
        return (value as (path: string, body?: object) => unknown).call(
          target,
          path,
          body,
        );
      };
    },
  });
}
