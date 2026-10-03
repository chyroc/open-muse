import { describe, expect, it } from "vitest";
import { larkSignedIn } from "../shared/lark-status";
import { t } from "../shared/i18n";
import type { AgentEvent } from "../shared/types";

let n = 0;
// One shell command and its output, as MA records them.
function run(command: string, output: string): AgentEvent[] {
  const id = `call_${++n}`;
  return [
    { id, type: "agent.tool_use", name: "bash", input: { command } },
    {
      id: `result_${n}`,
      type: "agent.tool_result",
      tool_use_id: id,
      content: [
        { type: "text", text: `exit_code: 0\n--- stdout ---\n${output}` },
      ],
    },
  ];
}
const status = (tokenStatus: string) =>
  JSON.stringify(
    { identity: "user", available: true, tokenStatus, appId: "cli_test" },
    null,
    2,
  );

describe("Lark sign-in from lark-cli output", () => {
  it("is unknown until lark-cli reports a sign-in either way", () => {
    expect(larkSignedIn([])).toBeUndefined();
    expect(
      larkSignedIn([
        ...run("lark-cli config init --new", "等待配置应用..."),
        ...run("echo identity", '"identity": "user", "tokenStatus": "ready"'),
      ]),
    ).toBeUndefined();
  });

  it("follows the last sign-in, missing token, or sign-out", () => {
    const login = run(
      '/opt/open-muse/lark-cli auth login --device-code "$DC"',
      "OK: 登录成功! 用户: Someone",
    );
    expect(larkSignedIn(login)).toBe(true);
    expect(larkSignedIn(run("lark-cli whoami", status("ready")))).toBe(true);
    expect(
      larkSignedIn([
        ...login,
        ...run(
          "lark-cli calendar +agenda --as user",
          "No current user identity (not logged in or session expired).",
        ),
      ]),
    ).toBe(false);
    expect(larkSignedIn([...login, ...run("lark-cli auth logout", "OK")])).toBe(
      false,
    );
    expect(
      larkSignedIn([
        ...run("lark-cli auth status", status("expired")),
        ...run("lark-cli auth login --device-code x", "OK: Login successful"),
      ]),
    ).toBe(true);
  });

  it("ignores results of other commands and unmatched results", () => {
    expect(
      larkSignedIn([
        {
          id: "orphan",
          type: "agent.tool_result",
          tool_use_id: "missing",
          content: [{ type: "text", text: "OK: 登录成功" }],
        },
      ]),
    ).toBeUndefined();
  });

  it("has Chinese copy for the signed-in row and sign-out request", () => {
    expect(t("Sign me out of Lark with lark-cli.", {}, "zh-CN")).toBe(
      "帮我用 lark-cli 退出飞书登录。",
    );
    expect(
      t(
        "Signed in to your Lark account in your assistant's cloud environment. When the main chat continues into a new chapter, sign in again.",
        {},
        "zh-CN",
      ),
    ).toContain("飞书");
  });
});
