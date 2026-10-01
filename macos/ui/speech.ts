import { useCallback, useEffect, useState } from "react";
import { systemLanguage } from "../../shared/i18n";

// Read aloud: the native shell speaks a reply with the Mac's own voices and
// reports back with a muse-speech event when it finishes or is stopped.
export const speechEvent = "muse-speech";
export type SpeechEnded = { id: string; finished: boolean };

type Bridge = { postMessage: (value: object) => Promise<unknown> };
function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museSpeech?: Bridge } };
    }
  ).webkit?.messageHandlers?.museSpeech;
}
export const speechAvailable = () => Boolean(bridge());

// Markdown read as prose: code, addresses and markup are left out.
export function speechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, "")
    .replace(/[*_~|]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, 8000);
}

// Chinese text gets a Chinese voice whatever the interface language is.
export function speechLanguage(text: string) {
  if (/[㐀-鿿]/.test(text)) return "zh-CN";
  return systemLanguage() === "zh-CN" ? "zh-CN" : "en-US";
}

export async function speak(id: string, markdown: string) {
  const native = bridge();
  const text = speechText(markdown);
  if (!native || !text) return false;
  return (
    (await native.postMessage({
      operation: "speak",
      id,
      text,
      language: speechLanguage(text),
    })) === true
  );
}
export async function stopSpeaking() {
  await bridge()?.postMessage({ operation: "stop" });
}

// Which message is being read; pressing it again, or another one, stops it.
export function useReadAloud() {
  const [speaking, setSpeaking] = useState<string>();
  useEffect(() => {
    const ended = (event: Event) => {
      const detail = (event as CustomEvent<SpeechEnded>).detail;
      if (!detail || typeof detail.id !== "string") return;
      setSpeaking((current) => (current === detail.id ? undefined : current));
    };
    window.addEventListener(speechEvent, ended);
    return () => window.removeEventListener(speechEvent, ended);
  }, []);
  // Leaving the window's page stops what it was reading.
  useEffect(() => () => void stopSpeaking().catch(() => {}), []);
  const toggle = useCallback(
    async (id: string, markdown: string) => {
      if (speaking === id) {
        setSpeaking(undefined);
        await stopSpeaking();
        return;
      }
      if (await speak(id, markdown)) setSpeaking(id);
    },
    [speaking],
  );
  return { speaking, toggle };
}
