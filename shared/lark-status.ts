import type { AgentEvent } from "./types";

// Whether the assistant is signed in to Lark as the person, from what
// lark-cli printed in one conversation's cloud environment: the last command
// that shows a user sign-in, a missing or expired one, or a sign-out decides.
// Undefined when nothing in these events says either way. This only labels
// the Connectors page; it never grants or approves anything.
const signedIn = [
  /^OK:\s*(登录成功|Login successful)/im,
  /"identity":\s*"user"[\s\S]*?"tokenStatus":\s*"ready"/,
  /"tokenStatus":\s*"ready"[\s\S]*?"identity":\s*"user"/,
];
const signedOut = [
  /not logged in/i,
  /No current user identity/i,
  /need_user_authorization/,
  /token_missing/,
  /refresh[ _]token expired/i,
  /"tokenStatus":\s*"(expired|missing|invalid|none)"/,
];

const text = (event: AgentEvent) =>
  (event.content as { type: string; text?: string }[] | undefined)
    ?.map((block) => block.text ?? "")
    .join("\n") ?? "";
const command = (event: AgentEvent) => {
  const input = event.input as { command?: unknown } | undefined;
  return typeof input?.command === "string" ? input.command : "";
};

export function larkSignedIn(events: AgentEvent[]): boolean | undefined {
  const commands = new Map<string, string>();
  let state: boolean | undefined;
  for (const event of events) {
    if (event.type === "agent.tool_use") {
      if (/\blark-cli\b/.test(command(event)))
        commands.set(event.id, command(event));
      continue;
    }
    if (event.type !== "agent.tool_result") continue;
    const ran = commands.get(event.tool_use_id ?? "");
    if (ran === undefined) continue;
    const output = text(event);
    if (/\bauth\s+logout\b/.test(ran) && /exit_code:\s*0\b/.test(output))
      state = false;
    else if (signedIn.some((pattern) => pattern.test(output))) state = true;
    else if (signedOut.some((pattern) => pattern.test(output))) state = false;
  }
  return state;
}
