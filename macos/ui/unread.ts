import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../shared/types";

// Replies that arrive while the workspace is in the background are counted on
// the Dock icon; the count clears as soon as the person comes back.
export class UnreadCounter {
  private key?: string;
  private known = new Set<string>();
  private baselined = false;

  // Returns how many replies are new since the last call. The first messages
  // seen for a conversation are history, not news, so they only set a baseline.
  observe(key: string | undefined, messages: AgentEvent[]) {
    if (key !== this.key) {
      this.key = key;
      this.known = new Set();
      this.baselined = false;
    }
    if (!messages.length) return 0;
    let fresh = 0;
    for (const message of messages) {
      if (this.known.has(message.id)) continue;
      this.known.add(message.id);
      if (this.baselined && message.type === "agent.message") fresh += 1;
    }
    this.baselined = true;
    return fresh;
  }
}

export const badgeLabel = (count: number) =>
  count <= 0 ? "" : count > 99 ? "99+" : String(count);

const active = () => !window.document.hidden && window.document.hasFocus();

function postBadge(count: number) {
  (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow?.postMessage({
    name: "badge",
    value: badgeLabel(count),
  });
}

export function useUnreadBadge(
  key: string | undefined,
  messages: AgentEvent[],
) {
  const counter = useRef(new UnreadCounter());
  const [count, setCount] = useState(0);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    const fresh = counter.current.observe(key, messages);
    if (fresh && !active()) setCount((value) => value + fresh);
    // Only a new last message can add a reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, last]);
  useEffect(() => {
    const clear = () => {
      if (active()) setCount(0);
    };
    window.addEventListener("focus", clear);
    window.document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("focus", clear);
      window.document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  const posted = useRef(0);
  useEffect(() => {
    if (posted.current === count) return;
    posted.current = count;
    postBadge(count);
  }, [count]);
  return count;
}
