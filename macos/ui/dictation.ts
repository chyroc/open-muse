// Voice input for the composer, recognized by macOS. Text streams in as
// muse-dictation events from the native shell while the person talks.
export type Permission = "allowed" | "denied" | "not-asked";
export type DictationState = {
  microphone: Permission;
  speech: Permission;
  onDevice: boolean;
  running: boolean;
};
export type DictationEvent =
  { text: string; final: boolean } | { ended: true; error?: string };
export const dictationEvent = "muse-dictation";

type Bridge = { postMessage: (value: object) => Promise<unknown> };
function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museDictation?: Bridge } };
    }
  ).webkit?.messageHandlers?.museDictation;
}
export const dictationAvailable = () => Boolean(bridge());

const permissions: Permission[] = ["allowed", "denied", "not-asked"];
export function parseDictationState(
  value: unknown,
): DictationState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return permissions.includes(record.microphone as Permission) &&
    permissions.includes(record.speech as Permission) &&
    typeof record.onDevice === "boolean" &&
    typeof record.running === "boolean"
    ? {
        microphone: record.microphone as Permission,
        speech: record.speech as Permission,
        onDevice: record.onDevice,
        running: record.running,
      }
    : undefined;
}

async function call(body: Record<string, string>) {
  const native = bridge();
  if (!native) return undefined;
  return parseDictationState(await native.postMessage(body));
}
export const readDictation = (language: string) =>
  call({ operation: "status", language });
export const requestDictation = (language: string) =>
  call({ operation: "request", language });
export const startDictation = (language: string, cues = true) =>
  call({ operation: "start", language, cues: cues ? "true" : "false" });

// Device-local dictation preferences.
export type DictationPreferences = { autoSend: boolean; cues: boolean };
const preferenceKey = "muse.dictation";
export function dictationPreferences(): DictationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
    return { autoSend: value.autoSend === true, cues: value.cues !== false };
  } catch {
    return { autoSend: false, cues: true };
  }
}
export function saveDictationPreferences(value: DictationPreferences) {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(value));
  } catch {
    // The choice still applies to this session.
  }
  return value;
}
export const stopDictation = (cancel = false) =>
  call({ operation: "stop", cancel: cancel ? "true" : "false" });
export const openMicrophoneSettings = () => call({ operation: "settings" });

// Dictated text continues the draft that was there when listening started.
export function joinDictation(base: string, spoken: string) {
  if (!spoken) return base;
  if (!base || /\s$/.test(base)) return base + spoken;
  // Chinese and other CJK text is not separated by spaces.
  const cjk = /[\u3000-\u9fff\uff00-\uffef]/;
  if (cjk.test(base.at(-1)!) || cjk.test(spoken[0])) return base + spoken;
  return `${base} ${spoken}`;
}
