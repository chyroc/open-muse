import { identityInstructions, systemWithIdentity } from "./identity";
import { ApiError } from "./ark";
import type { Session } from "./types";

export interface AgentSnapshot {
  id: string;
  version: number;
  system: string;
  metadata?: Record<string, string>;
  model?: unknown;
  tools?: unknown;
  mcp_servers?: unknown;
  skills?: unknown;
  multiagent?: unknown;
}

export const unreadableInstructions =
  "The agent instructions could not be read. No replacement conversation was created.";

// JSON object order is not a revision. MA may serialize tool input maps in a
// different order on successive reads; array and event order remain significant.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export function agentSnapshot(session: Session): AgentSnapshot | undefined {
  const agent = (session as Session & { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") return;
  const value = agent as AgentSnapshot;
  if (
    typeof value.id !== "string" ||
    !/^[\w-]{1,200}$/.test(value.id) ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    typeof value.system !== "string"
  )
    return;
  return value;
}

function identityBlock(system: string) {
  const start = "<open-muse-identity>";
  const end = "</open-muse-identity>";
  const first = system.indexOf(start);
  const last = system.indexOf(end);
  if (first < 0 && last < 0) return "";
  if (
    first < 0 ||
    last < first ||
    system.indexOf(start, first + start.length) >= 0 ||
    system.indexOf(end, last + end.length) >= 0
  )
    throw new ApiError(502, unreadableInstructions);
  return system.slice(first, last + end.length);
}

export function needsPromptRefresh(
  session: Session,
  owner: string,
  id: string,
) {
  const snapshot = agentSnapshot(session);
  if (snapshot?.id !== id || snapshot.metadata?.open_muse_workspace !== owner)
    return false;
  return identityBlock(snapshot.system) !== identityInstructions;
}

// Pin the original public Agent version rather than adopting the latest model
// and tools. Only the app-owned identity block changes; session custom text and
// the scoped history instructions remain intact. Unsupported session-specific
// runtime overrides must not be silently discarded during a rollover.
export function refreshedAgentSystem(
  snapshot: AgentSnapshot,
  versioned: AgentSnapshot,
) {
  if (snapshot.id !== versioned.id || snapshot.version !== versioned.version)
    throw new ApiError(502, unreadableInstructions);
  for (const field of [
    "model",
    "tools",
    "mcp_servers",
    "skills",
    "multiagent",
  ] as const) {
    if (canonicalJson(snapshot[field]) !== canonicalJson(versioned[field]))
      throw new ApiError(502, unreadableInstructions);
  }
  identityBlock(snapshot.system);
  return systemWithIdentity(snapshot.system);
}
