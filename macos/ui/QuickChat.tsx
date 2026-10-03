import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, Maximize2, Mic } from "lucide-react";
import { t } from "../../shared/i18n";
import { eventText, taskState } from "../../shared/types";
import type { Client } from "../../src/api";
import { Markdown } from "../../src/components";
import { useTask } from "../../src/useTask";
import { Avatar } from "./Chrome";
import { chatMessages, shouldSendOnKey } from "./model";
import { AssistantContent } from "./ChoiceContent";
import { connectionReady } from "./startup";
import { dictationAvailable } from "./dictation";
import { useDictation } from "./useDictation";
import { connectionRoute } from "./settings";

// How much of the main chat the card shows above its composer.
export const QUICK_HISTORY = 6;
// The card asks the shell for a height in this range and never scrolls the page.
export const QUICK_MIN_HEIGHT = 132;
export const QUICK_MAX_HEIGHT = 560;

type WindowBridge = { postMessage: (value: object) => void };
function shell(): WindowBridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museWindow?: WindowBridge } };
    }
  ).webkit?.messageHandlers?.museWindow;
}
export function quickHeight(content: number) {
  return Math.round(
    Math.min(QUICK_MAX_HEIGHT, Math.max(QUICK_MIN_HEIGHT, content)),
  );
}
function post(name: string, value?: string) {
  try {
    shell()?.postMessage(value === undefined ? { name } : { name, value });
  } catch {
    // The card keeps working inside the page if the shell is gone.
  }
}

// A small card over whatever app is in front. It talks to the same main chat
// as the workspace window, and leaves everything else to that window.
export function QuickChat({ client }: { client: Client }) {
  const [ready, setReady] = useState(client.signedIn());
  const [mainId, setMainId] = useState<string>();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const task = useTask(client, mainId);
  const events = task.session?.id === mainId ? task.events : [];
  const messages = chatMessages(
    events.filter(
      (event) => !event.source_session_id || event.source_session_id === mainId,
    ),
  ).slice(-QUICK_HISTORY);
  const running = taskState(events, task.session?.status) === "running";
  const sendRef = useRef<() => Promise<void>>(async () => {});
  const dictation = useDictation({
    draft,
    setDraft,
    onFinished: () => void sendRef.current(),
    onError: setError,
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  const reload = useCallback(async () => {
    try {
      const config = await client.config();
      if (!alive.current) return;
      setReady(config.mode === "ark");
      if (config.mode !== "ark") return setMainId(undefined);
      const [index, identity] = await Promise.all([
        client.conversationIndex(),
        client.companionIdentity(),
      ]);
      if (!alive.current) return;
      setMainId(index.mainId);
      setName(identity.name);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    }
  }, [client]);
  useEffect(() => {
    alive.current = true;
    const shown = () => {
      void reload();
      composer.current?.focus();
    };
    const credentials = () => void client.restore().then(reload);
    window.addEventListener("muse-quick-shown", shown);
    window.addEventListener(connectionReady, shown);
    window.addEventListener("muse-credentials-changed", credentials);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) post("quick-close");
    };
    window.addEventListener("keydown", key);
    // The shell's dictation shortcuts: push to talk sends start and stop,
    // hands-free sends toggle.
    const dictate = (event: Event) => {
      const action = (event as CustomEvent).detail;
      const current = dictationRef.current;
      if (action === "start") void current.start();
      else if (action === "stop") void current.stop();
      else if (action === "toggle") void current.toggle();
    };
    window.addEventListener("muse-quick-dictate", dictate);
    void reload();
    post("quick-ready");
    return () => {
      window.removeEventListener("muse-quick-dictate", dictate);
      alive.current = false;
      window.removeEventListener("muse-quick-shown", shown);
      window.removeEventListener(connectionReady, shown);
      window.removeEventListener("muse-credentials-changed", credentials);
      window.removeEventListener("keydown", key);
    };
  }, [client, reload]);
  // The shell sizes the panel to the card, so it grows with the conversation
  // instead of scrolling an empty frame.
  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const report = () =>
      post("quick-size", String(quickHeight(node.scrollHeight)));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.at(-1)?.id, messages.length]);
  // Grow the composer with its text, up to a few lines.
  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [draft]);

  sendRef.current = send;
  async function send() {
    const text = draft.trim();
    if (!text || busy || running) return;
    if (!ready) return post("settings", connectionRoute);
    setBusy(true);
    setError("");
    try {
      let target = mainId;
      if (!target) {
        target = (await client.openConversation("main", t("Main chat"))).id;
        if (alive.current) setMainId(target);
      }
      await client.send(target, { type: "user.message", text });
      if (!alive.current) return;
      setDraft("");
      post("quick-sent");
      await task.refresh();
    } catch (failure) {
      // An unconfirmed send keeps its text so it can be checked, not repeated.
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="quick-card" ref={card}>
      <header className="quick-header">
        <Avatar />
        <strong>{name || t("Main chat")}</strong>
        <button
          className="quick-icon"
          aria-label={t("Open in the main window")}
          title={t("Open in the main window")}
          onClick={() => post("workspace")}
        >
          <Maximize2 size={14} />
        </button>
      </header>
      {messages.length > 0 && (
        <div
          className="quick-messages"
          ref={list}
          role="log"
          aria-label={t("Chat messages")}
        >
          {messages.map((event) => (
            <article
              key={event.id}
              className={`quick-message ${event.type === "user.message" ? "from-user" : "from-assistant"}`}
            >
              {event.type === "user.message" ? (
                <Markdown text={eventText(event)} />
              ) : (
                // Questions are answered in the workspace; here they read as
                // the question with its options, never as raw JSON.
                <AssistantContent
                  text={eventText(event)}
                  part="all"
                  active={false}
                  busy={false}
                  streaming={false}
                  onChoose={() => {}}
                />
              )}
            </article>
          ))}
          {running && (
            <p className="quick-thinking" role="status">
              {t("{name} is working…", { name: name || "Muse" })}
            </p>
          )}
        </div>
      )}
      {!ready && (
        <button
          className="quick-connect"
          onClick={() => post("settings", connectionRoute)}
        >
          {t("Connect to Ark MA")}
        </button>
      )}
      {error && (
        <p className="quick-error" role="alert">
          {error}
        </p>
      )}
      <div className="quick-composer">
        <textarea
          ref={composer}
          rows={1}
          autoFocus
          value={draft}
          placeholder={t("Message")}
          aria-label={t("Message")}
          disabled={!ready}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (shouldSendOnKey(event.nativeEvent)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {dictationAvailable() && (
          <button
            className={`quick-icon quick-dictate ${dictation.listening ? "listening" : ""}`}
            aria-label={
              dictation.listening ? t("Stop dictation") : t("Dictate a message")
            }
            aria-pressed={dictation.listening}
            title={
              dictation.listening ? t("Stop dictation") : t("Dictate a message")
            }
            disabled={!ready}
            onClick={() => void dictation.toggle()}
          >
            <Mic size={15} />
          </button>
        )}
        <button
          className="quick-send"
          aria-label={t("Send")}
          disabled={!draft.trim() || busy || running || !ready}
          onClick={() => void send()}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
