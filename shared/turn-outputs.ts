import type { LibraryFile } from "./library";
import type { AgentEvent } from "./types";

const time = (event: AgentEvent) =>
  Date.parse(event.created_at ?? event.processed_at ?? "");

// Files the companion saved to the Library during a turn, shown under that
// turn's last visible reply: a turn runs from one of the person's messages to
// the next, and a file belongs to the turn in which it was created.
export function turnOutputs(
  events: readonly AgentEvent[],
  files: readonly LibraryFile[],
  hidden: ReadonlySet<string> = new Set(),
) {
  const outputs = new Map<string, LibraryFile[]>();
  const starts = events
    .map((event, index) => (event.type === "user.message" ? index : -1))
    .filter((index) => index >= 0);
  starts.forEach((start, turnIndex) => {
    const next = starts[turnIndex + 1];
    const from = time(events[start]);
    const to = next === undefined ? Infinity : time(events[next]);
    if (!Number.isFinite(from)) return;
    const reply = events
      .slice(start + 1, next ?? events.length)
      .filter(
        (event) => event.type === "agent.message" && !hidden.has(event.id),
      )
      .at(-1);
    if (!reply) return;
    const made = files
      .filter((file) => {
        const created = Date.parse(file.created_at);
        return created >= from && created < to;
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (made.length) outputs.set(reply.id, made);
  });
  return outputs;
}
