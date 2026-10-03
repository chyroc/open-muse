import { z } from "zod";
import type { ActivityStep, ActivityTurn } from "./activity";
import type { Language } from "./i18n";

// Activity rows read best as short labels of what was done, not as the
// person's request repeated. A small, fast model writes them once per
// finished request from what the conversation already holds.
export const summaryModel = "doubao-seed-2-1-turbo-260628";
// Longer requests are labeled from their first steps, which keeps the reply
// short enough to arrive in seconds.
export const maxSummarizedSteps = 30;
// A request whose labels could not be written is tried again a day later.
export const summaryRetryAfter = 24 * 60 * 60 * 1000;

export const activitySummaryInput = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().max(160),
  steps: z
    .array(
      z.object({
        title: z.string().trim().max(120),
        description: z.string().trim().max(600),
      }),
    )
    .max(maxSummarizedSteps),
});
export type ActivitySummary = z.infer<typeof activitySummaryInput> & {
  language: Language;
};
// What this device knows about one request's labels: written, or when the
// last attempt failed.
export type SummaryRecord = ActivitySummary | { failed: number };

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

const instructions = {
  "zh-CN":
    'Reply in Simplified Chinese with JSON only: {"title": the task in at most 12 characters, verb first, no punctuation, "summary": the outcome in one line of at most 24 characters, "steps": [{"title": what the step did in at most 20 characters, "description": one sentence of at most 40 characters on what happened and what came back}]}.',
  en: 'Reply in English with JSON only: {"title": the task in at most 6 words, verb first, no final period, "summary": the outcome in one line of at most 12 words, "steps": [{"title": what the step did in at most 10 words, "description": one sentence of at most 20 words on what happened and what came back}]}.',
} as const;

// The chat completion request that labels one finished request.
export function summaryRequest(
  turn: ActivityTurn,
  steps: readonly ActivityStep[],
  language: Language,
) {
  const shown = steps.slice(0, maxSummarizedSteps);
  return {
    model: summaryModel,
    reasoning_effort: "minimal",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You label an assistant's completed work for an activity log. ${instructions[language]} Give exactly ${shown.length} step entries, one per step in the given order. Describe only what the data shows; never invent results. Never include credentials, tokens or other secrets.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          request: clip(turn.request, 500),
          outcome: clip(turn.error ?? turn.reply, 600),
          steps: shown.map((step) => ({
            tool: step.label,
            target: step.target,
            note: clip(step.note, 200),
            input: clip(step.input, 300),
            result: clip(step.result, 300),
          })),
        }),
      },
    ],
  };
}

// The labels from a model reply, or undefined when it is not usable. Step
// labels are kept only when they line up one to one with the steps.
export function parseSummary(
  content: unknown,
  stepCount: number,
  language: Language,
): ActivitySummary | undefined {
  if (typeof content !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return undefined;
  }
  const parsed = activitySummaryInput.safeParse(value);
  if (!parsed.success) return undefined;
  const expected = Math.min(stepCount, maxSummarizedSteps);
  return {
    ...parsed.data,
    steps: parsed.data.steps.length === expected ? parsed.data.steps : [],
    language,
  };
}
