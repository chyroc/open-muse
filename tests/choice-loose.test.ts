import { describe, expect, it } from "vitest";
import {
  parseChoiceMessage,
  readableLooseChoices,
} from "../shared/chat-choices";

describe("XML-style choice tags in replies", () => {
  const reply =
    '下午好，隔了一阵，来看看你。<muse-choice question="现在到哪一步了？"> - 已经跑完，结果满意 - 还在调，卡在某个环节 - 先放一放，忙别的去了 </muse-choice>';

  it("shows the question and options as plain text, never controls", () => {
    const message = parseChoiceMessage(reply);
    expect(message.choice).toBeUndefined();
    expect(message.text).not.toContain("<muse-choice");
    expect(message.text).toBe(
      "下午好，隔了一阵，来看看你。\n\n现在到哪一步了？\n\n- 已经跑完，结果满意\n- 还在调，卡在某个环节\n- 先放一放，忙别的去了",
    );
  });

  it("keeps line-separated options and text without tags unchanged", () => {
    expect(
      readableLooseChoices(
        '<muse-choice question="Pick one">\n- Kit\n- Milo\n</muse-choice>',
      ),
    ).toBe("\n\nPick one\n\n- Kit\n- Milo");
    expect(readableLooseChoices("A normal reply")).toBe("A normal reply");
  });
});
