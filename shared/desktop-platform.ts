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
