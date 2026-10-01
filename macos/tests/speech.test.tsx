import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { MessageActions } from "../ui/MessageActions";
import { speechLanguage, speechText, useReadAloud } from "../ui/speech";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});
function shell() {
  const postMessage = vi.fn(async (_body: Record<string, string>) => true);
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { museSpeech: { postMessage } } },
  });
  return postMessage;
}
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}

describe("Mac read aloud", () => {
  it("reads markdown as prose", () => {
    expect(
      speechText(
        "## Plan\n\n- **Run** 5k at [the park](https://example.com)\n- See https://example.com/x\n\n```js\nconsole.log(1)\n```\nUse `npm test`.",
      ),
    ).toBe("Plan\nRun 5k at the park\nSee\nUse npm test.");
    expect(speechText("| a | b |\n|---|---|\n| 1 | 2 |")).not.toContain("---");
  });

  it("picks a Chinese voice for Chinese text", () => {
    expect(speechLanguage("明天下午三点开会")).toBe("zh-CN");
    expect(speechLanguage("Meeting at three")).toBe("en-US");
  });

  it("reads one reply at a time and follows the shell's end event", async () => {
    const post = shell();
    let api: ReturnType<typeof useReadAloud> | undefined;
    function Probe() {
      api = useReadAloud();
      return <span>{api.speaking ?? "idle"}</span>;
    }
    await mount(<Probe />);
    await act(async () => api!.toggle("sevt_1", "**Hello** there"));
    expect(post).toHaveBeenLastCalledWith({
      operation: "speak",
      id: "sevt_1",
      text: "Hello there",
      language: "en-US",
    });
    expect(host!.textContent).toBe("sevt_1");
    // Another reply's end does not clear this one.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("muse-speech", {
          detail: { id: "sevt_0", finished: false },
        }),
      );
    });
    expect(host!.textContent).toBe("sevt_1");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("muse-speech", {
          detail: { id: "sevt_1", finished: true },
        }),
      );
    });
    expect(host!.textContent).toBe("idle");
    await act(async () => api!.toggle("sevt_2", "Second"));
    await act(async () => api!.toggle("sevt_2", "Second"));
    expect(post).toHaveBeenLastCalledWith({ operation: "stop" });
    expect(host!.textContent).toBe("idle");
  });

  it("offers read aloud on assistant replies only when provided", async () => {
    const onSpeak = vi.fn();
    await mount(
      <MessageActions
        fromAssistant
        busy={false}
        onMood={vi.fn()}
        onReply={vi.fn()}
        onCopy={vi.fn()}
        onSelect={vi.fn()}
        speaking
        onSpeak={onSpeak}
      />,
    );
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>('[aria-label="More options"]')!
        .click(),
    );
    const item = [...host!.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent === "Stop reading",
    ) as HTMLButtonElement;
    await act(async () => item.click());
    expect(onSpeak).toHaveBeenCalledOnce();
  });

  it("translates its copy and keeps the native contract", () => {
    for (const key of ["Read aloud", "Stop reading"])
      expect(zhCN[key], key).toBeTruthy();
    const speaker = readFileSync("macos/Speaker.swift", "utf8");
    expect(speaker).toContain("AVSpeechSynthesizer()");
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain('name: "museSpeech"');
    // Dictation never records the Mac's own voice.
    expect(swift).toContain(
      "// The microphone must not hear the Mac reading aloud.\n            speaker.stop()",
    );
    expect(readFileSync("scripts/build-macos.mjs", "utf8")).toContain(
      '"macos/Speaker.swift"',
    );
  });
});
