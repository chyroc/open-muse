import type { AgentEvent } from "./types";
import { eventText } from "./types";

// While the companion works through a task it narrates each step. Like the
// system's own task views, the conversation keeps the first reply (what it is
// about to do) and the final answer, and folds the narration in between into
// one card per turn.
export type WorkCard = {
  id: string;
  // The narration folded into the card, oldest first.
  steps: AgentEvent[];
  tools: number;
  browser: boolean;
  running: boolean;
};

const browserCommand = /muse_browser|chrome|chromium|cdp|playwright|puppeteer/i;

function usesBrowser(event: AgentEvent) {
  const input = (event as { input?: Record<string, unknown> }).input ?? {};
  return (
    event.name === "bash" && browserCommand.test(String(input.command ?? ""))
  );
}

export function workCards(events: readonly AgentEvent[], running: boolean) {
  // Messages folded into a card, and where each card is drawn: in place of
  // the message with that ID, or at the end of the conversation.
  const hidden = new Set<string>();
  const cardAt = new Map<string, WorkCard>();
  let trailing: WorkCard | undefined;
  const starts = events
    .map((event, index) => (event.type === "user.message" ? index : -1))
    .filter((index) => index >= 0);
  starts.forEach((start, turnIndex) => {
    const last = turnIndex === starts.length - 1;
    const turn = events.slice(
      start + 1,
      starts[turnIndex + 1] ?? events.length,
    );
    // Reading or updating memory is quiet bookkeeping, not a step.
    const tools = turn.filter(
      (event) =>
        event.type.endsWith("tool_use") && !event.name?.startsWith("memory_"),
    );
    if (!tools.length) return;
    const firstTool = turn.indexOf(tools[0]);
    const lastTool = turn.lastIndexOf(tools.at(-1)!);
    const live = last && running;
    const messages = turn
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) =>
          event.type === "agent.message" && eventText(event).trim(),
      );
    const steps = messages.filter(
      ({ index }, position) =>
        !(position === 0 && index < firstTool) && (live || index < lastTool),
    );
    const browser = tools.some(usesBrowser);
    if (!steps.length && !browser) return;
    const card: WorkCard = {
      id: `work-${tools[0].id}`,
      steps: steps.map(({ event }) => event),
      tools: tools.length,
      browser,
      running: live,
    };
    for (const { event } of steps) hidden.add(event.id);
    const shown = messages.find(
      ({ event, index }) => !hidden.has(event.id) && index > firstTool,
    );
    const anchor = steps[0]?.event ?? shown?.event;
    if (anchor) cardAt.set(anchor.id, card);
    else if (last) trailing = card;
  });
  return { hidden, cardAt, trailing };
}
