import { useCallback, useEffect, useRef, useState } from "react";
import { systemLanguage, t } from "../../shared/i18n";
import {
  dictationAvailable,
  dictationEvent,
  dictationPreferences,
  joinDictation,
  readDictation,
  requestDictation,
  startDictation,
  stopDictation,
  type DictationEvent,
} from "./dictation";

// Dictation into one draft: spoken text replaces only what this dictation
// added, so typing before it started is kept. When it finishes on its own
// terms and automatic send is on, onFinished runs with the settled draft.
export function useDictation({
  draft,
  setDraft,
  onFinished,
  onError,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [finished, setFinished] = useState(false);
  const base = useRef<string>(undefined);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const handlers = useRef({ setDraft, onFinished, onError });
  handlers.current = { setDraft, onFinished, onError };
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  // A stop that arrives while listening is still starting, such as a released
  // push-to-talk key, ends it as soon as it has started.
  const starting = useRef(false);
  const stopAfterStart = useRef(false);
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<DictationEvent>).detail;
      if (!detail || typeof detail !== "object") return;
      if ("ended" in detail) {
        const started = base.current !== undefined;
        base.current = undefined;
        setListening(false);
        if (detail.error) handlers.current.onError(detail.error);
        else if (started && dictationPreferences().autoSend) setFinished(true);
        return;
      }
      if (base.current === undefined || typeof detail.text !== "string") return;
      handlers.current.setDraft(
        joinDictation(base.current, detail.text).slice(0, 16000),
      );
    };
    window.addEventListener(dictationEvent, listen);
    return () => window.removeEventListener(dictationEvent, listen);
  }, []);
  // Send once the dictated text has settled into the draft.
  useEffect(() => {
    if (!finished) return;
    setFinished(false);
    handlers.current.onFinished();
  }, [finished]);
  const start = useCallback(async () => {
    if (listeningRef.current || starting.current) return;
    if (!dictationAvailable())
      return handlers.current.onError(
        t(
          "Use macOS Dictation from the Edit menu. Built-in voice input needs the Mac app.",
        ),
      );
    const language = systemLanguage() === "zh-CN" ? "zh-CN" : "en-US";
    starting.current = true;
    stopAfterStart.current = false;
    try {
      let state = await readDictation(language);
      if (
        state &&
        (state.microphone === "not-asked" || state.speech === "not-asked")
      )
        state = await requestDictation(language);
      if (
        !state ||
        state.microphone !== "allowed" ||
        state.speech !== "allowed"
      )
        return handlers.current.onError(
          t(
            "Allow the microphone and speech recognition for Open Muse in System Settings.",
          ),
        );
      base.current = draftRef.current;
      await startDictation(language, dictationPreferences().cues);
      listeningRef.current = true;
      setListening(true);
      if (stopAfterStart.current) await stopDictation();
    } catch (failure) {
      base.current = undefined;
      setListening(false);
      handlers.current.onError((failure as Error).message);
    } finally {
      starting.current = false;
      stopAfterStart.current = false;
    }
  }, []);
  // Stopping keeps what was heard; the final result then ends the dictation.
  const stop = useCallback(async () => {
    if (starting.current) {
      stopAfterStart.current = true;
      return;
    }
    if (!listeningRef.current) return;
    await stopDictation().catch((failure: Error) =>
      handlers.current.onError(failure.message),
    );
  }, []);
  const toggle = useCallback(
    () => (listeningRef.current ? stop() : start()),
    [start, stop],
  );
  return { listening, start, stop, toggle };
}
