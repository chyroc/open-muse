import { useCallback, useEffect, useRef, useState } from "react";
import { eventText, type AgentEvent } from "../../shared/types";
import { systemLanguage, t } from "../../shared/i18n";
import {
  dictationEvent,
  readDictation,
  requestDictation,
  startDictation,
  stopDictation,
  type DictationEvent,
} from "./dictation";
import { speak, speechEvent, stopSpeaking, type SpeechEnded } from "./speech";

// A spoken back-and-forth in the open conversation: listen until the person
// pauses, send what was said, wait for the reply, read it aloud, listen again.
export type VoiceState = "off" | "listening" | "thinking" | "speaking";
// Silence after speech that ends a turn, and silence that ends the call.
export const VOICE_PAUSE_MS = 1500;
export const VOICE_IDLE_MS = 8000;
// A sent turn that never gets an answer, such as a failed send, hangs up.
export const VOICE_REPLY_MS = 120_000;
const language = () => (systemLanguage() === "zh-CN" ? "zh-CN" : "en-US");

export function useVoiceConversation({
  messages,
  running,
  submit,
  onError,
  onIdle,
}: {
  messages: AgentEvent[];
  running: boolean;
  submit: (text: string) => void;
  onError: (message: string) => void;
  onIdle: () => void;
}) {
  const [state, setState] = useState<VoiceState>("off");
  const stateRef = useRef<VoiceState>("off");
  const heard = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Replies already in the conversation when the turn was sent.
  const before = useRef(new Set<string>());
  const speakingId = useRef("");
  const handlers = useRef({ submit, onError, onIdle });
  handlers.current = { submit, onError, onIdle };
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const move = (next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const end = useCallback(() => {
    const was = stateRef.current;
    clear();
    move("off");
    heard.current = "";
    if (was === "listening") void stopDictation(true).catch(() => {});
    if (was === "speaking") void stopSpeaking().catch(() => {});
  }, []);
  const listen = useCallback(async () => {
    heard.current = "";
    move("listening");
    clear();
    // Nobody spoke: hang up rather than keep the microphone open.
    timer.current = setTimeout(() => {
      if (stateRef.current !== "listening" || heard.current) return;
      handlers.current.onIdle();
      end();
    }, VOICE_IDLE_MS);
    try {
      await startDictation(language(), true);
    } catch (failure) {
      end();
      handlers.current.onError((failure as Error).message);
    }
  }, [end]);
  useEffect(() => {
    const dictated = (event: Event) => {
      if (stateRef.current !== "listening") return;
      const detail = (event as CustomEvent<DictationEvent>).detail;
      if (!detail || typeof detail !== "object") return;
      if ("ended" in detail) {
        clear();
        if (detail.error) {
          end();
          return handlers.current.onError(detail.error);
        }
        const text = heard.current.trim();
        if (!text) return void listen();
        before.current = new Set(
          messagesRef.current
            .filter((item) => item.type === "agent.message")
            .map((item) => item.id),
        );
        move("thinking");
        timer.current = setTimeout(() => {
          if (stateRef.current === "thinking") end();
        }, VOICE_REPLY_MS);
        handlers.current.submit(text);
        return;
      }
      if (typeof detail.text !== "string") return;
      heard.current = detail.text;
      clear();
      // A pause after speech ends the turn; stopping keeps what was heard.
      timer.current = setTimeout(
        () => void stopDictation().catch(() => {}),
        VOICE_PAUSE_MS,
      );
    };
    const spoken = (event: Event) => {
      const detail = (event as CustomEvent<SpeechEnded>).detail;
      if (stateRef.current !== "speaking" || detail?.id !== speakingId.current)
        return;
      if (detail.finished) void listen();
      else end();
    };
    window.addEventListener(dictationEvent, dictated);
    window.addEventListener(speechEvent, spoken);
    return () => {
      window.removeEventListener(dictationEvent, dictated);
      window.removeEventListener(speechEvent, spoken);
    };
  }, [end, listen]);
  // The reply is complete when the agent stops and has said something new.
  useEffect(() => {
    if (state !== "thinking" || running) return;
    const replies = messages.filter(
      (item) => item.type === "agent.message" && !before.current.has(item.id),
    );
    if (!replies.length) return;
    clear();
    const last = replies.at(-1)!;
    speakingId.current = `voice-${last.id}`.replace(/[^A-Za-z0-9_-]/g, "-");
    move("speaking");
    void speak(
      speakingId.current,
      replies.map((item) => eventText(item)).join("\n\n"),
    )
      .then((started) => {
        if (!started && stateRef.current === "speaking") void listen();
      })
      .catch((failure: Error) => {
        end();
        handlers.current.onError(failure.message);
      });
  }, [state, running, messages, listen, end]);
  useEffect(() => () => end(), [end]);
  const start = useCallback(async () => {
    if (stateRef.current !== "off") return;
    try {
      let access = await readDictation(language());
      if (
        access &&
        (access.microphone === "not-asked" || access.speech === "not-asked")
      )
        access = await requestDictation(language());
      if (
        !access ||
        access.microphone !== "allowed" ||
        access.speech !== "allowed"
      )
        return handlers.current.onError(
          t(
            "Allow the microphone and speech recognition for Open Muse in System Settings.",
          ),
        );
      await listen();
    } catch (failure) {
      handlers.current.onError((failure as Error).message);
    }
  }, [listen]);
  return { state, start, end };
}
