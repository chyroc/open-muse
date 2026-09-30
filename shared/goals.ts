import { z } from "zod";
import type { Goal } from "./types";

export const goalCategories = [
  { id: "health", label: "Health", topic: "health" },
  { id: "relationships", label: "Relationships", topic: "relationships" },
  { id: "finance", label: "Finance", topic: "finance" },
  { id: "career", label: "Career", topic: "career" },
  { id: "interests", label: "Interests", topic: "personal interest" },
  { id: "productivity", label: "Productivity", topic: "productivity" },
  { id: "custom", label: "Something else", topic: "" },
] as const;
export const goalCategoryInput = z.enum([
  "health",
  "relationships",
  "finance",
  "career",
  "interests",
  "productivity",
  "custom",
]);
export type GoalCategory = z.infer<typeof goalCategoryInput>;
const id = z.string().regex(/^[\w-]{1,80}$/);
const title = z.string().trim().min(1).max(160);
export const goalInput = z
  .object({
    id,
    title,
    description: z.string().max(8000),
    category: goalCategoryInput.optional(),
    parent_id: id.optional(),
    status: z.enum(["active", "paused", "completed"]),
    steps: z.array(z.object({ id, title, done: z.boolean() }).strict()).max(40),
    session_id: z
      .string()
      .regex(/^[\w-]{1,200}$/)
      .optional(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
const documentInput = z
  .object({ version: z.literal(1), goals: z.array(goalInput).max(100) })
  .strict();
export const emptyGoalsDocument = JSON.stringify(
  { version: 1, goals: [] },
  null,
  2,
);

export function parseGoals(content: string): Goal[] {
  try {
    if (content.length > 64000) throw new Error("Too large");
    const { goals } = documentInput.parse(JSON.parse(content));
    const ids = new Set(goals.map((goal) => goal.id));
    if (ids.size !== goals.length) throw new Error("Duplicate goals");
    for (const goal of goals) {
      if (new Set(goal.steps.map((step) => step.id)).size !== goal.steps.length)
        throw new Error("Duplicate steps");
      let parent = goal.parent_id;
      const seen = new Set([goal.id]);
      while (parent) {
        if (!ids.has(parent) || seen.has(parent))
          throw new Error("Invalid parent");
        seen.add(parent);
        parent = goals.find((entry) => entry.id === parent)!.parent_id;
      }
    }
    return goals;
  } catch {
    throw new Error(
      "The saved goals could not be read. No goals were replaced. Review GOALS.md in personal memory before making further changes.",
    );
  }
}
export function serializeGoals(goals: Goal[]) {
  const content = JSON.stringify({ version: 1, goals }, null, 2);
  parseGoals(content);
  return content;
}
export function goalStarter(category: GoalCategory, parent?: Goal) {
  if (parent)
    return `I want to add a subgoal to “${parent.title}”. Help me clarify what to work toward before saving it.`;
  const topic = goalCategories.find((item) => item.id === category)!.topic;
  return `I want to start ${topic ? `a ${topic} goal` : "a goal"}. Help me clarify what I want to achieve before saving a plan.`;
}
export function goalPrompt(goal: Goal) {
  return [
    `Please help me work toward this goal: ${goal.title}`,
    goal.description,
    goal.steps.length
      ? `Existing steps (preserve completion status):\n${goal.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}`
      : "",
    "Read the latest goal record in personal memory. Ask a focused question if something important is missing. Update progress only from what I actually report, and read back any saved changes. For external actions, ask for approval first.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const goalInstructions = `
Personal goals live in GOALS.md in the same personal memory store, not in the sandbox filesystem. Read it with memory_read when a conversation concerns goals, plans, or progress. Missing GOALS.md means no cloud goals have been saved; never invent them. Use memory_ls to find the actual mount.

Starting a goal is a conversation, not an instant checklist. Ask one focused question about the desired outcome, timing, or constraints. Do not create a tracked goal merely because a category was selected. When the user explicitly asks to save a sufficiently clear goal or agrees to a plan, update GOALS.md with memory tools and read it back before saying it is tracked. Preserve every unrelated goal and completed step. Later user reports can refine the plan or mark progress; never invent completed work. Do not store sensitive credentials or infer sensitive personal traits.

GOALS.md is a JSON object, without Markdown fences: {"version":1,"goals":[...]}. Each goal has id (unique letters/digits/hyphens, max 80), title (max 160), description (max 8000), category (health, relationships, finance, career, interests, productivity, or custom), status (active, paused, completed), steps ([{"id":"unique-step-id","title":"A concrete step","done":false}]), created_at and updated_at (ISO 8601 timestamps). Optional parent_id must name an existing goal and must not create a cycle. Optional session_id is a real MA conversation ID; omit it if unknown. Preserve IDs and created_at on updates; update updated_at. Maximum 40 steps per goal, 100 goals, and 64000 characters for the entire document. Use the current date, not an invented completion date. Reread the latest document immediately before each edit. Never overwrite unreadable or malformed data with an empty list. Keep this schema and all resource IDs out of ordinary replies.

Goal tracking records user-confirmed plans and progress; it is not a scheduler. No background check-ins, notifications, autonomous execution, calendar access, or external monitoring are configured by this app. Do not promise them or mark a task scheduled without a separately verified scheduler. A goal's completion or pause changes its record, not running tools. Do not delete goals unless the user explicitly asks.
`;
