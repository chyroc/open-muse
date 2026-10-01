import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import type { AgentEvent } from "../../shared/types";
import {
  useVoiceConversation,
  VOICE_IDLE_MS,
  VOICE_PAUSE_MS,
} from "../ui/voice";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.useRealTimers();
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});

const allowed = {
  microphone: "allowed",
  speech: "allowed",
  onDevice: true,
  running: false,
};
function shell() {
  const dictation = vi.fn(async (_body: Record<string, string>) => ({
    ...allowed,
  }));
  const speech = vi.fn(async (_body: Record<string, string>) => true);
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: {
      messageHandlers: {
        museDictation: { postMessage: dictation },
        museSpeech: { postMessage: speech },
      },
    },
  });
  return { dictation, speech };
}
const reply = (id: string, text: string) =>
  ({
    id,
    type: "agent.message",
    content: [{ type: "text", text }],
  }) as AgentEvent;

let api: ReturnType<typeof useVoiceConversation> | undefined;
function Probe(props: {
  messages: AgentEvent[];
  running: boolean;
  submit: (text: string) => void;
  onIdle: () => void;
}) {
  api = useVoiceConversation({ ...props, onError: vi.fn() });
  return <span>{api.state}</span>;
}
async function render(props: Parameters<typeof Probe>[0]) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(<Probe {...props} />));
}
const emit = (name: string, detail: unknown) =>
  act(async () => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  });
const operations = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map(([body]) => (body as { operation: string }).operation);

describe("Mac voice conversation", () => {
  it("listens, sends after a pause, reads the reply and listens again", async () => {
    const { dictation, speech } = shell();
    const submit = vi.fn();
    const props = {
      messages: [reply("old", "Earlier answer")],
      running: false,
      submit,
      onIdle: vi.fn(),
    };
    await render(props);
    await act(async () => api!.start());
    expect(operations(dictation)).toEqual(["status", "start"]);
    expect(host!.textContent).toBe("listening");
    await emit("muse-dictation", { text: "Book a table", final: false });
    await act(async () => vi.advanceTimersByTime(VOICE_PAUSE_MS));
    expect(dictation).toHaveBeenLastCalledWith({
      operation: "stop",
      cancel: "false",
    });
    await emit("muse-dictation", { ended: true });
    expect(submit).toHaveBeenCalledWith("Book a table");
    expect(host!.textContent).toBe("thinking");
    // Still working: nothing is read yet.
    await render({ ...props, running: true });
    await render({
      ...props,
      running: false,
      messages: [...props.messages, reply("new", "**Booked** for 7pm.")],
    });
    expect(speech).toHaveBeenLastCalledWith({
      operation: "speak",
      id: "voice-new",
      text: "Booked for 7pm.",
      language: "en-US",
    });
    expect(host!.textContent).toBe("speaking");
    await emit("muse-speech", { id: "voice-new", finished: true });
    expect(host!.textContent).toBe("listening");
    expect(operations(dictation).at(-1)).toBe("start");
  });

  it("hangs up when nobody speaks", async () => {
    const { dictation } = shell();
    const onIdle = vi.fn();
    await render({ messages: [], running: false, submit: vi.fn(), onIdle });
    await act(async () => api!.start());
    await act(async () => vi.advanceTimersByTime(VOICE_IDLE_MS));
    expect(onIdle).toHaveBeenCalledOnce();
    expect(dictation).toHaveBeenLastCalledWith({
      operation: "stop",
      cancel: "true",
    });
    expect(host!.textContent).toBe("off");
  });

  it("stops reading when the person ends the conversation", async () => {
    const { speech } = shell();
    const props = {
      messages: [] as AgentEvent[],
      running: false,
      submit: vi.fn(),
      onIdle: vi.fn(),
    };
    await render(props);
    await act(async () => api!.start());
    await emit("muse-dictation", { text: "Hello", final: true });
    await emit("muse-dictation", { ended: true });
    await render({ ...props, messages: [reply("r1", "Hi there")] });
    expect(host!.textContent).toBe("speaking");
    await act(async () => api!.end());
    expect(speech).toHaveBeenLastCalledWith({ operation: "stop" });
    expect(host!.textContent).toBe("off");
  });

  it("translates the voice states and controls", () => {
    for (const key of [
      "Start a voice conversation",
      "End the voice conversation",
      "Listening…",
      "Thinking…",
      "Speaking…",
      "End",
      "The voice conversation ended because nothing was heard.",
    ])
      expect(zhCN[key], key).toBeTruthy();
    const css = readFileSync("macos/ui/desktop.css", "utf8");
    expect(css).toContain(".voice-bar .voice-dot {\n    animation: none;");
  });
});
