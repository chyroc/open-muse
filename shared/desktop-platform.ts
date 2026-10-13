// Which desktop shell hosts the desktop web app: the Mac app, or the Windows
// app, which sets window.__OPEN_MUSE_PLATFORM__ before the page runs. Both
// load the same bundle and answer the same mac_* device tools (an agent may
// have only eight custom tools); this decides the wording a person reads.
export type DesktopPlatform = "mac" | "windows";

export function desktopPlatform(): DesktopPlatform {
  return (globalThis as { __OPEN_MUSE_PLATFORM__?: unknown })
    .__OPEN_MUSE_PLATFORM__ === "windows"
    ? "windows"
    : "mac";
}

// The person's computer as the running app names it: their Mac or their PC in
// the desktop apps, and only "computer" on a phone or the web, which cannot
// tell which desktop app will answer a mac_* call.
export function computerWord<T>(words: { mac: T; windows: T; any: T }): T {
  const desktop =
    (globalThis as { __OPEN_MUSE_DESKTOP__?: unknown })
      .__OPEN_MUSE_DESKTOP__ === true;
  if (!desktop) return words.any;
  return desktopPlatform() === "windows" ? words.windows : words.mac;
}

export const onWindows = () => desktopPlatform() === "windows";

// One piece of desktop copy in its Mac or its Windows form.
export function forPlatform<T>(mac: T, windows: T): T {
  return onWindows() ? windows : mac;
}

// The key that carries the app's shortcuts: Command on a Mac, Ctrl on Windows.
export function primaryModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  return onWindows() ? event.ctrlKey : event.metaKey;
}

// An app shortcut written the Mac way (⌘K, ⇧⌘F) as the running app shows it:
// unchanged on a Mac, Ctrl+K and Ctrl+Shift+F on Windows.
export function keysLabel(mac: string) {
  if (!onWindows()) return mac;
  const names: Record<string, string> = {
    "⌃": "Ctrl",
    "⌘": "Ctrl",
    "⌥": "Alt",
    "⇧": "Shift",
  };
  const order = ["Ctrl", "Alt", "Shift"];
  const modifiers = new Set<string>();
  let rest = "";
  const keys: Record<string, string> = { "⎋": "Esc", "↩": "Enter", "⇥": "Tab" };
  for (const symbol of mac) {
    if (names[symbol]) modifiers.add(names[symbol]);
    else rest += keys[symbol] ?? symbol;
  }
  return [...order.filter((name) => modifiers.has(name)), rest].join("+");
}
