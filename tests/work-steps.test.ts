import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/types";
import { workCards } from "../shared/work-steps";

let n = 0;
const ev = (type: string, extra: Record<string, unknown> = {}) =>
  ({ id: `e${++n}`, type, ...extra }) as AgentEvent;
const say = (text: string) =>
  ev("agent.message", { content: [{ type: "text", text }] });
const tool = (name: string, input: Record<string, unknown> = {}) =>
  ev("agent.tool_use", { name, input });

describe("Work cards", () => {
  it("keeps the first reply and the answer, folding the narration between", () => {
    const ack = say("On it.");
    const step1 = say("Opening the page.");
    const step2 = say("Reading prices.");
    const answer = say("Here is the table.");
    const events = [
      ev("user.message"),
      ack,
      tool("bash", { command: "python shot.py --cdp" }),
      step1,
      tool("bash"),
      step2,
      tool("write"),
      answer,
    ];
    const work = workCards(events, false);
    expect([...work.hidden]).toEqual([step1.id, step2.id]);
    const card = work.cardAt.get(step1.id)!;
    expect(card.steps.map((step) => step.id)).toEqual([step1.id, step2.id]);
    expect(card).toMatchObject({ tools: 3, browser: true, running: false });
    expect(work.hidden.has(ack.id) || work.hidden.has(answer.id)).toBe(false);
  });
  it("keeps the first reply after quiet memory reads", () => {
    const ack = say("On it.");
    const step = say("Comparing.");
    const answer = say("Done.");
    const work = workCards(
      [
        ev("user.message"),
        tool("memory_ls"),
        tool("memory_read"),
        ack,
        tool("web_search"),
        step,
        tool("web_fetch"),
        tool("memory_write"),
        answer,
      ],
      false,
    );
    expect([...work.hidden]).toEqual([step.id]);
    expect(work.cardAt.get(step.id)?.tools).toBe(2);
  });
  it("folds the newest message too while the turn is running", () => {
    const ack = say("On it.");
    const step = say("Still checking.");
    const work = workCards(
      [ev("user.message"), ack, tool("web_search"), step],
      true,
    );
    expect(work.hidden.has(step.id)).toBe(true);
    expect(work.cardAt.get(step.id)?.running).toBe(true);
  });
  it("adds no card for quiet tool use, and places a browser-only card before the answer", () => {
    const quiet = workCards(
      [ev("user.message"), tool("memory_read"), say("You like hiking.")],
      false,
    );
    expect(quiet.hidden.size + quiet.cardAt.size).toBe(0);
    const answer = say("Done.");
    const browsed = workCards(
      [
        ev("user.message"),
        tool("bash", { command: "chrome --headless" }),
        answer,
      ],
      false,
    );
    expect(browsed.cardAt.get(answer.id)?.browser).toBe(true);
    expect(browsed.hidden.size).toBe(0);
  });
  it("draws a running card with no messages yet at the end", () => {
    const work = workCards(
      [ev("user.message"), tool("bash", { command: "cdp.py" })],
      true,
    );
    expect(work.trailing?.running).toBe(true);
  });
});
