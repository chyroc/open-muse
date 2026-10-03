import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digest, uuid } from "../shared/crypto";
import {
  emptyGoalsDocument,
  goalInstructions,
  goalPlanningMessage,
  goalStarter,
  isGoalPlanningMessage,
  parseGoals,
  serializeGoals,
} from "../shared/goals";
import type { Goal } from "../shared/types";
import { DirectGoals } from "../src/direct/goals";
import { LocalDatabase } from "../src/direct/storage";

afterEach(() => vi.unstubAllGlobals());

function goal(id = "goal-one"): Goal {
  return {
    id,
    title: "Read a chapter",
    description: "Build a reading habit",
    category: "interests",
    status: "active",
    steps: [{ id: "read", title: "Read chapter one", done: false }],
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  };
}
function fixture() {
  let content = emptyGoalsDocument,
    id: string | undefined;
  const identity = {
    goalsDocument: vi.fn(async () => ({
      name: "GOALS.md" as const,
      content,
      revision: digest(content),
      id,
    })),
    saveGoalsDocument: vi.fn(async (next: string, revision: string) => {
      expect(revision).toBe(digest(content));
      content = next;
      id = "doc-one";
      return {
        name: "GOALS.md" as const,
        content,
        revision: digest(content),
        id,
      };
    }),
  };
  const db = new LocalDatabase(`goals-${uuid()}`);
  const service = new DirectGoals("owner", db, identity);
  return {
    identity,
    db,
    service,
    remote(next: Goal[]) {
      content = serializeGoals(next);
      id = "doc-one";
    },
    corrupt() {
      content = "not-json";
    },
  };
}
describe("Cloud goal documents", () => {
  it("round-trips categories, hierarchy, steps and confirmed progress", () => {
    const parent = goal(),
      child = {
        ...goal("child"),
        parent_id: parent.id,
        status: "completed" as const,
      };
    expect(parseGoals(serializeGoals([parent, child]))).toEqual([
      parent,
      child,
    ]);
  });
  it.each([
    "duplicate",
    "cycle",
    "missing-parent",
    "duplicate-step",
    "unsafe-id",
    "invalid-date",
  ])("rejects %s without substituting an empty plan", (kind) => {
    const row = goal();
    const goals = [row];
    if (kind === "duplicate") goals.push(row);
    if (kind === "cycle") row.parent_id = row.id;
    if (kind === "missing-parent") row.parent_id = "missing";
    if (kind === "duplicate-step") row.steps.push(row.steps[0]);
    if (kind === "unsafe-id") row.id = "../private";
    if (kind === "invalid-date") row.created_at = "tomorrow";
    expect(() => serializeGoals(goals)).toThrow("No goals were replaced");
  });
  it.each([
    ["en", "I want to set a health goal", "I want to set a goal"],
    ["zh-Hans", "我想设定一个health目标", "我想设定一个目标"],
  ])(
    "starts planning a category's goal with one message in %s",
    (language, health, custom) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      try {
        expect(goalPlanningMessage("health")).toBe(health);
        expect(goalPlanningMessage("custom")).toBe(custom);
        // Recognized in either language, so every device shows the planning.
        for (const text of [health, custom, ` ${health} `])
          expect(isGoalPlanningMessage(text)).toBe(true);
        expect(isGoalPlanningMessage("我想设定一个health目标吧")).toBe(false);
        expect(isGoalPlanningMessage("I want to set a hobby goal")).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
  it("requires clarification before goal creation and never promises background scheduling", () => {
    expect(goalStarter("health")).toContain("before saving");
    expect(goalStarter("custom")).toContain("start a goal");
    expect(goalStarter("interests", goal())).toContain("subgoal");
    expect(goalInstructions).toContain(
      "Do not create a tracked goal merely because a category was selected",
    );
    expect(goalInstructions).toContain("read it back");
    expect(goalInstructions).toContain("not a scheduler");
  });
});
describe("Direct goal persistence", () => {
  it("uses an origin-wide Web Lock across separate local views", async () => {
    const f = fixture();
    let queue = Promise.resolve();
    const request = vi.fn((_name: string, fn: () => Promise<void>) => {
      const result = queue.then(fn);
      queue = result.catch(() => {});
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const other = new DirectGoals("owner", f.db, f.identity);
    await Promise.all([
      f.service.create(goal("one")),
      other.create(goal("two")),
    ]);
    expect((await f.service.snapshot()).data).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(([name]) => name === "open-muse-goals:owner"),
    ).toBe(true);
  });
  it("keeps navigation and legacy reads read-only", async () => {
    const f = fixture();
    await f.db.set("owner:goals", [goal()]);
    expect((await f.service.snapshot()).data).toEqual([goal()]);
    expect(f.identity.saveGoalsDocument).not.toHaveBeenCalled();
  });
  it("imports legacy goals on an explicit action and preserves local originals", async () => {
    const f = fixture();
    await f.db.set("owner:goals", [goal()]);
    await f.service.prepare();
    expect(f.identity.saveGoalsDocument).toHaveBeenCalledOnce();
    expect(await f.db.get("owner:goals")).toEqual([goal()]);
    await f.service.prepare();
    expect(f.identity.saveGoalsDocument).toHaveBeenCalledOnce();
    const otherDevice = new DirectGoals(
      "owner",
      new LocalDatabase(`second-${uuid()}`),
      f.identity,
    );
    expect((await otherDevice.snapshot()).data).toEqual([goal()]);
  });
  it("never resurrects imported local records after their cloud removal", async () => {
    const f = fixture();
    await f.db.set("owner:goals", [goal()]);
    await f.service.prepare();
    f.remote([]);
    expect((await f.service.snapshot()).data).toEqual([]);
    expect(await f.db.get("owner:goals")).toEqual([goal()]);
  });
  it("uses the latest cloud record rather than an old local copy", async () => {
    const f = fixture();
    await f.db.set("owner:goals", [goal()]);
    f.remote([{ ...goal(), status: "completed" }]);
    await f.service.prepare();
    expect((await f.service.snapshot()).data[0].status).toBe("completed");
    expect(f.identity.saveGoalsDocument).not.toHaveBeenCalled();
  });
  it("serializes same-client cloud mutations without losing goals", async () => {
    const f = fixture();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => f.service.create(goal(`goal-${i}`))),
    );
    expect((await f.service.snapshot()).data).toHaveLength(10);
  });
  it("preserves assistant changes and rejects stale UI edits", async () => {
    const f = fixture();
    f.remote([goal()]);
    const first = await f.service.snapshot();
    f.remote([
      {
        ...goal(),
        steps: [{ id: "read", title: "Read chapter one", done: true }],
      },
    ]);
    await expect(
      f.service.update("goal-one", { title: "Stale rename" }, first.revision),
    ).rejects.toThrow("goals changed");
    expect(f.identity.saveGoalsDocument).not.toHaveBeenCalled();
    expect((await f.service.snapshot()).data[0].steps[0].done).toBe(true);
  });
  it("keeps uncertain write outcomes visible without automatically repeating them", async () => {
    const f = fixture();
    f.remote([goal()]);
    f.identity.saveGoalsDocument.mockRejectedValueOnce(
      new Error("Response lost"),
    );
    await expect(
      f.service.update("goal-one", { status: "completed" }),
    ).rejects.toThrow("Response lost");
    expect(f.identity.saveGoalsDocument).toHaveBeenCalledOnce();
    expect(await f.db.get("owner:goals:imported")).toBeUndefined();
  });
  it("does not overwrite malformed cloud data or silently hide legacy records", async () => {
    const f = fixture();
    await f.db.set("owner:goals", [goal()]);
    f.corrupt();
    await expect(f.service.prepare()).rejects.toThrow("No goals were replaced");
    expect(f.identity.saveGoalsDocument).not.toHaveBeenCalled();
    expect(await f.db.get("owner:goals")).toEqual([goal()]);
  });
  it("updates only the selected goal and retains unrelated and completed steps", async () => {
    const f = fixture();
    f.remote([goal(), { ...goal("other"), status: "completed" }]);
    await f.service.update("goal-one", { title: "New name" });
    const data = (await f.service.snapshot()).data;
    expect(data.find((row) => row.id === "other")).toEqual({
      ...goal("other"),
      status: "completed",
    });
    expect(data.find((row) => row.id === "goal-one")!.steps).toEqual(
      goal().steps,
    );
  });
});
