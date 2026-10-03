import { describe, expect, it } from "vitest";
import {
  modelCatalog,
  modelChoiceInput,
  modelOverride,
  sessionUsesModel,
} from "../shared/models";
import type { Session } from "../shared/types";
import { DEFAULT_MODEL } from "../shared/workspace-spec";

const session = (model: unknown) =>
  ({ id: "s", agent: { id: "a", model } }) as unknown as Session;

describe("Model choice", () => {
  it("lists the default model first, with the models that read images", () => {
    expect(modelCatalog[0].id).toBe(DEFAULT_MODEL);
    expect(
      modelCatalog.filter((model) => model.vision).map((model) => model.id),
    ).toEqual([
      "doubao-seed-2-1-pro-260915",
      "doubao-seed-2-1-lite-260915",
      "doubao-seed-2-1-turbo-260628",
      "deepseek-v4-1-flash-260910",
    ]);
    for (const model of modelCatalog)
      expect(model.efforts).toContain(model.defaultEffort);
  });
  it("accepts only levels the model takes", () => {
    expect(
      modelChoiceInput.safeParse({ model: DEFAULT_MODEL, effort: "low" })
        .success,
    ).toBe(true);
    expect(
      modelChoiceInput.safeParse({
        model: "glm-5-3-flash-260828",
        effort: "medium",
      }).success,
    ).toBe(false);
    expect(
      modelChoiceInput.safeParse({ model: "unknown", effort: "low" }).success,
    ).toBe(false);
    expect(modelOverride({ model: DEFAULT_MODEL, effort: "low" })).toEqual({
      id: DEFAULT_MODEL,
      reasoning_effort: "low",
    });
  });
  it("tells whether a conversation already runs on the choice", () => {
    const choice = { model: DEFAULT_MODEL, effort: "high" as const };
    expect(
      sessionUsesModel(
        session({ id: DEFAULT_MODEL, reasoning_effort: "high" }),
        choice,
      ),
    ).toBe(true);
    // No level means the model's default.
    expect(sessionUsesModel(session({ id: DEFAULT_MODEL }), choice)).toBe(true);
    expect(
      sessionUsesModel(
        session({ id: DEFAULT_MODEL, reasoning_effort: "low" }),
        choice,
      ),
    ).toBe(false);
    expect(sessionUsesModel(session(undefined), choice)).toBe(false);
  });
});
