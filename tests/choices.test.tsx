import "fake-indexeddb/auto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import {
  choiceInstructions,
  currentChoiceEvent,
  parseChoiceMessage,
} from "../shared/chat-choices";
import type { AgentEvent, Session } from "../shared/types";
import { mergeHistorySnapshot } from "../shared/types";
import { ChoiceMessage } from "../src/ChoiceMessage";
import { DirectChoices } from "../src/direct/choices";
import { LocalDatabase } from "../src/direct/storage";

const question = {
  question: "When would a walk fit?",
  options: [
    { id: "morning", label: "Morning" },
    { id: "lunch", label: "After lunch" },
  ],
};
const block = (value: unknown = question) =>
  "```muse-choice\n" + JSON.stringify(value) + "\n```";
const revision = digest(block());
const prompt = (text = block()): AgentEvent => ({
  id: "question-one",
  type: "agent.message",
  content: [{ type: "text", text }],
});
function fixture() {
  const db = new LocalDatabase(`choices-${uuid()}`);
  const rows: AgentEvent[] = [prompt()];
  const session: Session = {
    id: "session-one",
    title: "Walk",
    category: "general",
    status: "idle",
    created_at: "",
    updated_at: "",
  };
  const remote = {
    history: vi.fn(async () => rows),
    session: vi.fn(async () => session),
    send: vi.fn(async (_session: string, text: string, id: string) => {
      const event = {
        id,
        type: "user.message",
        content: [{ type: "text", text }],
      };
      rows.push(event);
      return { data: [event] };
    }),
  };
  return {
    db,
    rows,
    session,
    remote,
    service: new DirectChoices("owner", db, remote),
  };
}

describe("Structured conversation choices", () => {
  it("updates persisted answer receipts without overwriting SSE received during a history read", () => {
    const old = prompt();
    const receipt = {
      eventId: "answer",
      optionId: "lunch",
      label: "After lunch",
      state: "confirmed" as const,
    };
    const fromHistory = { ...old, choice_reply: receipt };
    expect(
      mergeHistorySnapshot([old], [old], [fromHistory])[0].choice_reply,
    ).toEqual(receipt);
    const newer = {
      ...old,
      content: [{ type: "text", text: "New live content" }],
    };
    expect(mergeHistorySnapshot([old], [newer], [fromHistory])[0]).toEqual(
      newer,
    );
  });
  it("recognizes only a bounded explicit choice block, preserving surrounding prose", () => {
    expect(
      parseChoiceMessage(
        "A small step.\n" + block() + "\nOr type your own answer.",
      ),
    ).toEqual({
      text: "A small step.\nOr type your own answer.",
      before: "A small step.",
      after: "Or type your own answer.",
      choice: question,
    });
    expect(
      parseChoiceMessage("- Morning\n- After lunch").choice,
    ).toBeUndefined();
    const example = "````markdown\n" + block() + "\n````";
    expect(parseChoiceMessage(example)).toEqual({ text: example });
    const quote = block()
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
    expect(parseChoiceMessage(quote)).toEqual({ text: quote });
  });
  it("hides a partial protocol block until it is complete", () => {
    expect(parseChoiceMessage('Hello\n```muse-choice\n{"question":')).toEqual({
      text: "Hello",
      pending: true,
    });
    expect(parseChoiceMessage(block() + "\n" + block()).invalid).toBe(true);
  });
  it.each([
    { ...question, action: "delete" },
    {
      ...question,
      options: [
        { id: "one", label: "One", command: "hidden" },
        { id: "two", label: "Two" },
      ],
    },
    { ...question, options: question.options.slice(0, 1) },
    { ...question, options: [question.options[0], question.options[0]] },
    {
      ...question,
      options: [
        { id: "one", label: "Morning" },
        { id: "two", label: " morning " },
      ],
    },
    { ...question, question: "x".repeat(601) },
    {
      ...question,
      options: [
        { id: "../../bad", label: "One" },
        { id: "two", label: "Two" },
      ],
    },
  ])("rejects malformed or action-bearing options", (value) => {
    expect(parseChoiceMessage(block(value))).toEqual({
      text: "",
      invalid: true,
    });
  });
  it("makes only the latest unanswered question actionable", () => {
    expect(currentChoiceEvent([prompt()])?.id).toBe("question-one");
    expect(
      currentChoiceEvent([prompt(), { id: "user", type: "user.message" }]),
    ).toBeUndefined();
    expect(
      currentChoiceEvent([
        prompt(),
        { ...prompt("A later reply"), id: "later" },
      ]),
    ).toBeUndefined();
    expect(
      currentChoiceEvent([
        prompt(),
        { id: "status", type: "session.status_idle" },
      ])?.id,
    ).toBe("question-one");
    expect(choiceInstructions).toContain("only the visible option label");
    expect(choiceInstructions).toContain(
      "Never use a question widget as authorization",
    );
  });
  it("renders controls inside the message and retains the checked state", () => {
    const html = renderToStaticMarkup(
      <ChoiceMessage
        text={block()}
        active
        busy={false}
        streaming={false}
        onChoose={() => {}}
      />,
    );
    expect(html).toContain("When would a walk fit?");
    expect(html).toContain('aria-label="Choose After lunch"');
    expect(html).not.toContain("muse-choice");
    expect(html).not.toContain("disabled");
    const answered = renderToStaticMarkup(
      <ChoiceMessage
        text={block()}
        active={false}
        busy={false}
        streaming={false}
        onChoose={() => {}}
        reply={{
          eventId: "answer",
          optionId: "lunch",
          label: "After lunch",
          state: "confirmed",
        }}
      />,
    );
    expect(answered).toContain('aria-pressed="true"');
    expect(answered.match(/disabled=""/g)).toHaveLength(2);
    expect(answered).toContain('class="selected"');
  });
  it("does not execute markup and disables controls during streaming or uncertainty", () => {
    const text = block({
      ...question,
      options: [
        { id: "x", label: "<img src=x onerror=alert(1)>" },
        question.options[1],
      ],
    });
    const html = renderToStaticMarkup(
      <ChoiceMessage
        text={text}
        active
        busy={false}
        streaming
        onChoose={() => {}}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    const pending = renderToStaticMarkup(
      <ChoiceMessage
        text={block()}
        active
        busy={false}
        streaming={false}
        onChoose={() => {}}
        reply={{
          eventId: "answer",
          optionId: "lunch",
          label: "After lunch",
          state: "unconfirmed",
        }}
      />,
    );
    expect(pending).toContain("awaiting confirmation");
    expect(pending).not.toContain('aria-pressed="true"');
  });
});

describe("Durable choice replies", () => {
  it("rejects a changed question before sending a label the user did not see", async () => {
    const f = fixture();
    f.rows[0] = prompt(
      block({
        ...question,
        options: [
          { id: "morning", label: "Before sunrise" },
          question.options[1],
        ],
      }),
    );
    await expect(
      f.service.answer("session-one", "question-one", "morning", revision),
    ).rejects.toThrow("question changed");
    expect(f.remote.send).not.toHaveBeenCalled();
  });
  it("submits only the verified visible label and restores its receipt", async () => {
    const f = fixture();
    const reply = await f.service.answer(
      "session-one",
      "question-one",
      "lunch",
      revision,
    );
    expect(reply.state).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledExactlyOnceWith(
      "session-one",
      "After lunch",
      reply.eventId,
    );
    expect(
      await new DirectChoices("owner", f.db, f.remote).reply(
        "session-one",
        "question-one",
      ),
    ).toEqual(reply);
    await f.service.answer("session-one", "question-one", "lunch", revision);
    expect(f.remote.send).toHaveBeenCalledOnce();
    await expect(
      f.service.answer("session-one", "question-one", "morning", revision),
    ).rejects.toThrow("already been answered");
    expect(
      await new DirectChoices("another-owner", f.db, f.remote).reply(
        "session-one",
        "question-one",
      ),
    ).toBeUndefined();
    expect(
      await f.service.reply("another-session", "question-one"),
    ).toBeUndefined();
  });
  it("guards concurrent duplicate taps from separate local views", async () => {
    const f = fixture();
    const other = new DirectChoices("owner", f.db, f.remote);
    await Promise.allSettled([
      f.service.answer("session-one", "question-one", "morning", revision),
      other.answer("session-one", "question-one", "lunch", revision),
    ]);
    expect(f.remote.send).toHaveBeenCalledOnce();
  });
  it("recovers a lost POST response by exact event ID without resending", async () => {
    const f = fixture();
    f.remote.send.mockImplementationOnce(async (_session, text, id) => {
      f.rows.push({
        id,
        type: "user.message",
        content: [{ type: "text", text }],
      });
      throw new Error("Response lost");
    });
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow("Response lost");
    expect((await f.service.reply("session-one", "question-one"))?.state).toBe(
      "unconfirmed",
    );
    const restored = new DirectChoices("owner", f.db, f.remote);
    expect(
      (await restored.answer("session-one", "question-one", "lunch", revision))
        .state,
    ).toBe("confirmed");
    expect(f.remote.send).toHaveBeenCalledOnce();
  });
  it("never infers a receipt from matching text with a different event ID", async () => {
    const f = fixture();
    f.remote.send.mockRejectedValueOnce(new Error("Network lost"));
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow();
    f.rows.push({
      id: "unrelated",
      type: "user.message",
      content: [{ type: "text", text: "After lunch" }],
    });
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow("unconfirmed");
    expect(f.remote.send).toHaveBeenCalledOnce();
  });
  it("allows a deliberate retry only after a definitive rejection", async () => {
    const f = fixture();
    f.remote.send.mockRejectedValueOnce(new ApiError(429, "Try later"));
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow("Try later");
    expect((await f.service.reply("session-one", "question-one"))?.state).toBe(
      "rejected",
    );
    await f.service.answer("session-one", "question-one", "morning", revision);
    expect(f.remote.send).toHaveBeenCalledTimes(2);
  });
  it.each(["stale", "running", "terminated", "unknown-option", "user-content"])(
    "rejects %s without sending",
    async (kind) => {
      const f = fixture();
      if (kind === "stale") f.rows.push({ id: "user", type: "user.message" });
      if (kind === "running" || kind === "terminated") f.session.status = kind;
      if (kind === "user-content") f.rows[0].type = "user.message";
      await expect(
        f.service.answer(
          "session-one",
          "question-one",
          kind === "unknown-option" ? "unknown" : "lunch",
          revision,
        ),
      ).rejects.toThrow();
      expect(f.remote.send).not.toHaveBeenCalled();
    },
  );
  it("requires readback when an accepted response contains no matching event", async () => {
    const f = fixture();
    f.remote.send.mockResolvedValueOnce({ data: [] });
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow("unconfirmed");
    expect(f.remote.history).toHaveBeenCalledTimes(2);
    await expect(
      f.service.answer("session-one", "question-one", "lunch", revision),
    ).rejects.toThrow("unconfirmed");
    expect(f.remote.send).toHaveBeenCalledOnce();
  });
});
