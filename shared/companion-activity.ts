import type { AgentEvent } from "./types";

// A short line under the companion's name saying what it is doing, from the
// newest step of the current turn: the tool it is using, or that it is
// thinking. These are UI labels; t() translates them where they are shown.
export type CompanionActivity = {
  label: string;
  // Waiting on the person, shown in the accent color.
  attention?: boolean;
  // A turn is running; the companion is drawn at work.
  working?: boolean;
};

const browserCommand = /muse_browser|chrome|chromium|cdp|playwright|puppeteer/i;

function toolLabel(event: AgentEvent): string {
  const name = event.name ?? "";
  const input = (event as { input?: Record<string, unknown> }).input ?? {};
  if (name === "web_search") return "Searching the web";
  if (name === "web_fetch") return "Reading the web";
  if (name === "health_read") return "Reading Health";
  if (name.startsWith("mac_")) return "Using your Mac";
  if (name === "bash")
    return browserCommand.test(String(input.command ?? ""))
      ? "Using the browser"
      : "Running commands";
  if (name === "read") return "Looking at files";
  if (["write", "edit"].includes(name)) return "Putting files together";
  if (["glob", "grep"].includes(name)) return "Searching files";
  if (/^memory_(ls|read|search|list)/.test(name)) return "Recalling memory";
  if (name.startsWith("memory_")) return "Updating memory";
  return "Working hard";
}

// The activity of a running turn, or what it waits for; undefined when idle.
export function companionActivity(
  events: readonly AgentEvent[],
  state: {
    running: boolean;
    approval: boolean;
    mac: boolean;
    // Health reads answered without asking, once Health is connected.
    health?: "ask" | "auto";
    interrupted?: boolean;
  },
): CompanionActivity | undefined {
  if (state.approval) return { label: "Review needed", attention: true };
  if (state.health === "ask") return { label: "Review needed", attention: true };
  if (state.health === "auto")
    return { label: "Reading Health", working: true };
  if (state.mac) return { label: "Waiting for your Mac", attention: true };
  if (!state.running)
    return state.interrupted ? { label: "Connection interrupted" } : undefined;
  let start = events.length;
  while (start > 0 && events[start - 1].type !== "user.message") start--;
  const turn = events.slice(start);
  const answered = new Set(
    turn
      .filter((event) => event.type.endsWith("tool_result"))
      .map((event) => (event as { tool_use_id?: string }).tool_use_id),
  );
  for (let index = turn.length - 1; index >= 0; index--) {
    const event = turn[index];
    if (event.type.endsWith("tool_use") && !answered.has(event.id))
      return { label: toolLabel(event), working: true };
    if (event.type === "agent.thinking")
      return { label: "Thinking", working: true };
    if (event.type === "agent.message") break;
  }
  return { label: "Working hard", working: true };
}
