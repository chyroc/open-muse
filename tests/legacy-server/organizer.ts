import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./ark";
import type { Runtime } from "./ma";
import { eventText, type AgentEvent, type Goal } from "../../shared/types";

const title = z.string().trim().min(1).max(160);
const goalInput = z.object({
  title,
  description: z.string().trim().max(8000).default(""),
});
const updateInput = z.object({
  title: title.optional(),
  description: z.string().trim().max(8000).optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
  session_id: z.string().min(1).max(200).optional(),
  steps: z
    .array(
      z.object({ id: z.string().min(1).max(80), title, done: z.boolean() }),
    )
    .max(40)
    .optional(),
});

export function organizerRouter() {
  const router = Router();
  router.get("/goals", (_req, res) => {
    const { store } = res.locals.runtime as Runtime;
    res.json({
      data: [...(store.data.goals ?? [])].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      ),
    });
  });
  router.post("/goals", async (req, res) => {
    const input = goalInput.parse(req.body);
    const { store } = res.locals.runtime as Runtime;
    const now = new Date().toISOString();
    const goal: Goal = {
      ...input,
      id: randomUUID(),
      status: "active",
      steps: [],
      created_at: now,
      updated_at: now,
    };
    (store.data.goals ??= []).unshift(goal);
    await store.save();
    res.status(201).json(goal);
  });
  router.post("/goals/:id", async (req, res) => {
    const input = updateInput.parse(req.body);
    const { store } = res.locals.runtime as Runtime;
    const goal = store.data.goals?.find((g) => g.id === req.params.id);
    if (!goal) throw new ApiError(404, "Goal not found.");
    if (input.session_id && !store.get(input.session_id))
      throw new ApiError(
        404,
        "The linked session does not belong to the current workspace.",
      );
    if (
      input.steps &&
      new Set(input.steps.map((s) => s.id)).size !== input.steps.length
    )
      throw new ApiError(400, "Duplicate step IDs.");
    Object.assign(goal, input, { updated_at: new Date().toISOString() });
    await store.save();
    res.json(goal);
  });
  router.get("/library", (_req, res) => {
    const { store } = res.locals.runtime as Runtime;
    res.json({
      data: [...(store.data.library ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    });
  });
  // Persist only a real assistant event owned by this runtime, never arbitrary
  // client-supplied text claiming to be an MA result.
  router.post("/library", async (req, res) => {
    const input = z
      .object({
        session_id: z.string().min(1).max(200),
        event_id: z.string().min(1).max(200),
      })
      .parse(req.body);
    const { store, ark } = res.locals.runtime as Runtime;
    const session = store.get(input.session_id);
    if (!session) throw new ApiError(404, "Source session not found.");
    const existing = store.data.library?.find(
      (item) =>
        item.session_id === input.session_id &&
        item.event_id === input.event_id,
    );
    if (existing) return res.json(existing);
    let event: AgentEvent | undefined;
    {
      const seen = new Set<string>();
      let page: string | undefined;
      do {
        const result = await ark.events(session.id, page);
        event = result.data.find((e) => e.id === input.event_id);
        page = result.next_page;
        if (event || !page) break;
        if (seen.has(page) || seen.size >= 100)
          throw new ApiError(
            502,
            "Abnormal pagination for the source session; try again later.",
          );
        seen.add(page);
      } while (page);
    }
    if (!event || event.type !== "agent.message" || !eventText(event).trim())
      throw new ApiError(404, "No savable assistant reply found.");
    // Recheck after awaiting upstream; concurrent saves are idempotent.
    const library = (store.data.library ??= []);
    const duplicate = library.find(
      (item) =>
        item.session_id === input.session_id &&
        item.event_id === input.event_id,
    );
    if (duplicate) return res.json(duplicate);
    const item = {
      id: randomUUID(),
      title: session.title,
      text: eventText(event),
      ...input,
      created_at: new Date().toISOString(),
    };
    library.unshift(item);
    await store.save();
    res.status(201).json(item);
  });
  return router;
}
