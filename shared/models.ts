import { z } from "zod";
import type { Session } from "./types";

// Models the person can choose for their companion, with the thinking levels
// each one accepts when a conversation is created with a model override.
// Only levels the managed-agent service was seen to accept are listed.
export const efforts = ["minimal", "low", "medium", "high"] as const;
export type Effort = (typeof efforts)[number];

export type ModelOption = {
  id: string;
  name: string;
  // Reads images, including attached photos and video frames.
  vision: boolean;
  efforts: readonly Effort[];
  defaultEffort: Effort;
};

export const modelCatalog: readonly ModelOption[] = [
  {
    id: "doubao-seed-2-1-pro-260915",
    name: "Doubao Seed 2.1 Pro",
    vision: true,
    efforts,
    defaultEffort: "high",
  },
  {
    id: "doubao-seed-2-1-lite-260915",
    name: "Doubao Seed 2.1 Lite",
    vision: true,
    efforts,
    defaultEffort: "medium",
  },
  {
    id: "doubao-seed-2-1-turbo-260628",
    name: "Doubao Seed 2.1 Turbo",
    vision: true,
    efforts,
    defaultEffort: "minimal",
  },
  {
    id: "deepseek-v4-pro-ga-260813",
    name: "DeepSeek V4 Pro",
    vision: false,
    efforts: ["minimal", "low", "high"],
    defaultEffort: "high",
  },
  {
    id: "deepseek-v4-1-flash-260910",
    name: "DeepSeek V4.1 Flash",
    vision: true,
    efforts: ["low", "high"],
    defaultEffort: "high",
  },
  {
    id: "glm-5-3-flash-260828",
    name: "GLM-5.3 Flash",
    vision: false,
    efforts: ["low", "high"],
    defaultEffort: "high",
  },
];

export const modelOption = (id: string) =>
  modelCatalog.find((model) => model.id === id);

export const modelChoiceInput = z
  .object({
    model: z.string().refine((id) => Boolean(modelOption(id))),
    effort: z.enum(efforts),
  })
  .strict()
  .refine((choice) =>
    Boolean(modelOption(choice.model)?.efforts.includes(choice.effort)),
  );
export type ModelChoice = z.infer<typeof modelChoiceInput>;

// The override sent when a conversation is created.
export const modelOverride = (choice: ModelChoice) => ({
  id: choice.model,
  reasoning_effort: choice.effort,
});

// Whether a conversation already runs on the chosen model and thinking level.
// A conversation created without a level counts as the model's default.
export function sessionUsesModel(session: Session, choice: ModelChoice) {
  const model = (
    session as Session & {
      agent?: { model?: { id?: unknown; reasoning_effort?: unknown } } | string;
    }
  ).agent;
  if (!model || typeof model !== "object" || !model.model) return false;
  const effort =
    typeof model.model.reasoning_effort === "string"
      ? model.model.reasoning_effort
      : modelOption(choice.model)?.defaultEffort;
  return model.model.id === choice.model && effort === choice.effort;
}
