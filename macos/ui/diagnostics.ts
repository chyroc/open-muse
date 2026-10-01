import { backgroundClient } from "../../src/background-client";
import { activeLanguage, appVersion } from "./settings";
import { computerAvailable, readComputer } from "./computer";
import { dictationAvailable, readDictation } from "./dictation";
import {
  readShortcut,
  shortcutAvailable,
  shortcutLabel,
  shortcutSet,
  type ShortcutId,
} from "./shortcut";

// A plain summary of how this Mac's app is set up, for a person to paste into
// a problem report wherever they choose. It holds no keys, account or device
// identifiers, messages or files, and nothing here sends it anywhere.
export function systemVersion() {
  const value = (window as unknown as { __OPEN_MUSE_SYSTEM__?: unknown })
    .__OPEN_MUSE_SYSTEM__;
  return typeof value === "string" && /^[\w.\-() ]{1,80}$/.test(value)
    ? value
    : "unknown";
}

const yes = (value: boolean) => (value ? "on" : "off");

export async function diagnosticReport({ signedIn }: { signedIn: boolean }) {
  const { language, preferred } = activeLanguage();
  const lines = [
    `Open Muse ${appVersion() || "development build"}`,
    systemVersion(),
    `Language: ${language} (system: ${preferred.slice(0, 3).join(", ") || "unknown"})`,
    `Build: ${backgroundClient.configured() ? "account service" : "local only"}`,
    `Connected: ${signedIn ? "yes" : "no"}`,
  ];
  if (computerAvailable()) {
    const computer = await readComputer().catch(() => undefined);
    if (computer)
      lines.push(
        `Computer use: ${yes(computer.enabled)}; Accessibility: ${computer.accessibility ? "allowed" : "not allowed"}; Screen Recording: ${computer.screen ? "allowed" : "not allowed"}; blocked apps: ${computer.blocked.length}; blocked folders: ${computer.blockedFolders.length}`,
        `Calendar and Reminders: ${yes(computer.calendar.enabled)} (Calendar ${computer.calendar.events}, Reminders ${computer.calendar.reminders})`,
        `Location: ${yes(computer.location.enabled)} (${computer.location.permission})`,
      );
  }
  if (dictationAvailable()) {
    const dictation = await readDictation(
      language === "zh-CN" ? "zh-CN" : "en-US",
    ).catch(() => undefined);
    if (dictation)
      lines.push(
        `Microphone: ${dictation.microphone}; Speech recognition: ${dictation.speech}; on this Mac: ${dictation.onDevice ? "yes" : "no"}; inputs: ${dictation.devices.length}`,
      );
  }
  if (shortcutAvailable()) {
    const ids: ShortcutId[] = ["quickChat", "dictationHold", "dictationToggle"];
    const parts = await Promise.all(
      ids.map(async (id) => {
        const value = await readShortcut(id).catch(() => undefined);
        if (!value) return `${id} unknown`;
        if (!shortcutSet(value)) return `${id} not set`;
        return `${id} ${shortcutLabel(value)}${value.registered ? "" : " (refused by macOS)"}`;
      }),
    );
    lines.push(`Shortcuts: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}
