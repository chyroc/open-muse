// Shaking the iPhone opens Report a problem, as in other iOS apps. The native
// shell turns the system shake gesture into a "muse-shake" event on the page;
// Settings > Help & support turns it off on this device.
const key = "open-muse.shake-to-report";

export const shakeToReport = () =>
  globalThis.localStorage?.getItem(key) !== "off";

export function setShakeToReport(enabled: boolean) {
  if (enabled) globalThis.localStorage?.removeItem(key);
  else globalThis.localStorage?.setItem(key, "off");
}

// Calls `onShake` for each shake while the setting is on.
export function listenForShake(onShake: () => void) {
  const shaken = () => shakeToReport() && onShake();
  window.addEventListener("muse-shake", shaken);
  return () => window.removeEventListener("muse-shake", shaken);
}
