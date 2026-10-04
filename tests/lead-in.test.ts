import { describe, expect, it } from "vitest";
import { splitLeadIn } from "../src/lead-in";

describe("A reply's lead-in line", () => {
  it("takes a short first line before the summary", () => {
    expect(
      splitLeadIn("做好了 👇\n\n**成都两日游美食清单.pdf**\n\n- 第一天走老城"),
    ).toEqual({
      lead: "做好了 👇",
      rest: "**成都两日游美食清单.pdf**\n\n- 第一天走老城",
    });
  });

  it("leaves a reply alone when its first line is long or not plain", () => {
    expect(splitLeadIn("只有一段话")).toBeUndefined();
    expect(
      splitLeadIn(
        "清单做好了，文件在资源库里，按动线分两天，不绕路，第一天走老城，第二天去熊猫基地和建设巷。\n\n后面还有内容",
      ),
    ).toBeUndefined();
    expect(splitLeadIn("## 清单\n\n内容")).toBeUndefined();
    expect(splitLeadIn("- 第一项\n\n- 第二项")).toBeUndefined();
    expect(splitLeadIn("1. 第一步\n\n2. 第二步")).toBeUndefined();
    expect(splitLeadIn("| a | b |\n\n后文")).toBeUndefined();
  });
});
