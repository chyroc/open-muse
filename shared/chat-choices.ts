import { z } from "zod";
import { eventText, type AgentEvent } from "./types";

const choiceSchema = z
  .object({
    question: z.string().trim().min(1).max(600),
    options: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
            label: z.string().trim().min(1).max(160),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .refine(
    ({ options }) =>
      new Set(options.map((option) => option.id)).size === options.length &&
      new Set(
        options.map((option) => option.label.normalize("NFKC").toLowerCase()),
      ).size === options.length,
  );
export type ChatChoice = z.infer<typeof choiceSchema>;
export interface ChoiceReply {
  eventId: string;
  optionId: string;
  label: string;
  state: "sending" | "unconfirmed" | "confirmed" | "rejected";
}
export interface ChoiceMessage {
  text: string;
  before?: string;
  after?: string;
  choice?: ChatChoice;
  pending?: boolean;
  invalid?: boolean;
}

// A reply that wrote a question as an XML-style <muse-choice> tag instead of
// the fenced JSON block is shown as plain text: the question, then its
// options as a list. It never becomes tappable controls.
const looseChoice = /<muse-choice\b([^>]*)>([\s\S]*?)<\/muse-choice>/g;
export function readableLooseChoices(text: string) {
  return text.replace(looseChoice, (_, attributes: string, body: string) => {
    const question = /question\s*=\s*"([^"]*)"/.exec(attributes)?.[1]?.trim();
    const options = body
      .split(/\n|(?:^|\s)[-*•]\s+/)
      .map((option) => option.replace(/^[-*•]\s+/, "").trim())
      .filter(Boolean);
    return ["", question, options.map((option) => `- ${option}`).join("\n")]
      .filter((part) => part !== undefined)
      .join("\n\n");
  });
}

// Only a dedicated, top-level fenced block creates controls. Ordinary lists,
// quoted examples, code blocks and arbitrary HTML never become actions.
export function parseChoiceMessage(raw: string): ChoiceMessage {
  if (raw.length > 64000) return { text: raw };
  const text = readableLooseChoices(raw);
  const lines = text.split("\n");
  let fence: { marker: string; start: number; choice: boolean } | undefined;
  const blocks: { start: number; end: number; raw: string; closed: boolean }[] =
    [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (fence) {
      if (
        match[1][0] === fence.marker[0] &&
        match[1].length >= fence.marker.length &&
        !match[2].trim()
      ) {
        if (fence.choice)
          blocks.push({
            start: fence.start,
            end: i,
            raw: lines.slice(fence.start + 1, i).join("\n"),
            closed: true,
          });
        fence = undefined;
      }
    } else {
      fence = {
        marker: match[1],
        start: i,
        choice: match[2].trim() === "muse-choice",
      };
    }
  }
  if (fence?.choice)
    blocks.push({
      start: fence.start,
      end: lines.length - 1,
      raw: "",
      closed: false,
    });
  if (!blocks.length) return { text };
  const visible = lines
    .filter(
      (_, i) => !blocks.some((block) => i >= block.start && i <= block.end),
    )
    .join("\n")
    .trim();
  if (blocks.length !== 1) return { text: visible, invalid: true };
  const block = blocks[0];
  if (!block.closed) return { text: visible, pending: true };
  try {
    if (block.raw.length > 4000) throw new Error("Question too large");
    return {
      text: visible,
      before: lines.slice(0, block.start).join("\n").trim(),
      after: lines
        .slice(block.end + 1)
        .join("\n")
        .trim(),
      choice: choiceSchema.parse(JSON.parse(block.raw)),
    };
  } catch {
    return { text: visible, invalid: true };
  }
}

export function currentChoiceEvent(events: AgentEvent[]) {
  const last = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "user.message" || event.type === "agent.message",
    );
  return last?.type === "agent.message" &&
    parseChoiceMessage(eventText(last)).choice
    ? last
    : undefined;
}

export const choiceInstructions = [
  "When one focused question would help, ask it naturally. For a short set of useful alternatives, you may include one tappable single-choice question using the exact fenced format below. Do not turn every response into a questionnaire. Respect requests for an exact answer or plain text.",
  "```muse-choice",
  '{"question":"Your question","options":[{"id":"first","label":"First visible answer"},{"id":"second","label":"Second visible answer"}]}',
  "```",
  "Use 2 to 6 distinct options with concise labels (maximum 160 characters), unique simple IDs, and a question of at most 600 characters. Emit strict JSON with only the shown fields, exactly one block, outside other code fences. The app renders it as controls inside your message. Put the question ONLY in the JSON question field; surrounding prose, if any, must not ask it again. Keep it light, like texting: at most one short sentence of prose before the block, three or four options that each say enough in their label, and no list or paragraph that describes the options again. The person can always type a different answer instead. Ask about the person's preference or intended action, not a reminder or scheduled action you cannot deliver. For example, asking when they prefer a walk must not become an offer to remind them.",
  "Tapping sends only the visible option label as a normal user message. Treat it in the context of your question and continue the conversation. There are no hidden commands, tool calls, URLs or action payloads in an option. Never use a question widget as authorization for payments, deletion, account access or other sensitive operations; existing tool approval rules still apply. Do not generate widgets merely to demonstrate their syntax unless asked.",
].join("\n\n");
