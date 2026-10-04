import { identityInstructions, systemWithIdentity } from "./identity";
import { systemWithTools, toolingInstructions } from "./tooling";
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
export const incompatibleConversation =
  "This main chat's configuration cannot be safely updated. Its history is intact. Open a side chat to continue.";
export class IncompatibleConversation extends ApiError {
  constructor(message = incompatibleConversation) {
    super(409, message);
  }
}

// JSON object order is not a revision. MA may serialize tool input maps in a
// different order on successive reads; array and event order remain significant.
export function canonicalJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    ) ?? "undefined"
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

export function continuationAgent(session: Session, owner: string, id: string) {
  const snapshot = agentSnapshot(session);
  if (snapshot?.id !== id || snapshot.metadata?.open_muse_workspace !== owner)
    throw new IncompatibleConversation();
  return snapshot;
}

function identityBlock(system: string) {
  return appBlock(system, "<open-muse-identity>", "</open-muse-identity>");
}

// The tools block is only present when Open Muse manages the environment, so
// its absence is preserved rather than treated as stale.
function toolsBlock(system: string) {
  return appBlock(system, "<open-muse-tools>", "</open-muse-tools>");
}

function appBlock(system: string, start: string, end: string) {
  const first = system.indexOf(start);
  const last = system.indexOf(end);
  if (first < 0 && last < 0) return "";
  if (
    first < 0 ||
    last < first ||
    system.indexOf(start, first + start.length) >= 0 ||
    system.indexOf(end, last + end.length) >= 0
  )
    throw new IncompatibleConversation();
  return system.slice(first, last + end.length);
}

// The custom tools the person's own devices answer, as an agent lists them.
const customToolNames = (tools: unknown) =>
  Array.isArray(tools)
    ? tools.flatMap((tool) =>
        tool &&
        typeof tool === "object" &&
        (tool as { type?: unknown }).type === "custom" &&
        typeof (tool as { name?: unknown }).name === "string"
          ? [(tool as { name: string }).name]
          : [],
      )
    : [];

// Whether an agent with Open Muse device tools lacks one this app now
// answers, so a new chapter should run on the current agent version.
export function missingDeviceTools(
  snapshot: Pick<AgentSnapshot, "tools">,
  deviceTools: readonly string[],
) {
  const names = customToolNames(snapshot.tools);
  return (
    names.some((name) => deviceTools.includes(name)) &&
    deviceTools.some((name) => !names.includes(name))
  );
}

export function needsPromptRefresh(
  session: Session,
  owner: string,
  id: string,
  deviceTools: readonly string[] = [],
) {
  const snapshot = agentSnapshot(session);
  if (snapshot?.id !== id || snapshot.metadata?.open_muse_workspace !== owner)
    return false;
  const tools = toolsBlock(snapshot.system);
  return (
    identityBlock(snapshot.system) !== identityInstructions ||
    (tools !== "" && tools !== toolingInstructions) ||
    missingDeviceTools(snapshot, deviceTools)
  );
}

// Pin the original public Agent version rather than adopting the latest model
// and tools. Only the app-owned identity and tools text blocks change; session
// custom text and the scoped history instructions remain intact. Unsupported
// session-specific runtime overrides must not be silently discarded during a
// rollover.
export function refreshedAgentSystem(
  snapshot: AgentSnapshot,
  versioned: AgentSnapshot,
  // The person chose the model for new conversations, so the next chapter
  // runs on that choice whatever the previous one used.
  modelChosen = false,
  // Device tools the app answers. A later agent version is accepted when its
  // only difference is gaining some of them; nothing else may change.
  deviceTools: readonly string[] = [],
) {
  const upgrade =
    versioned.version > snapshot.version &&
    missingDeviceTools(snapshot, deviceTools);
  if (
    snapshot.id !== versioned.id ||
    (snapshot.version !== versioned.version && !upgrade)
  )
    throw new IncompatibleConversation();
  // Device tools may only be added; every other tool stays as it was.
  const withoutDevice = (tools: unknown) =>
    Array.isArray(tools)
      ? tools.filter(
          (tool) =>
            !(
              tool &&
              typeof tool === "object" &&
              (tool as { type?: unknown }).type === "custom" &&
              deviceTools.includes((tool as { name?: string }).name ?? "")
            ),
        )
      : tools;
  if (upgrade) {
    const before = customToolNames(snapshot.tools).filter((name) =>
      deviceTools.includes(name),
    );
    const after = customToolNames(versioned.tools);
    if (before.some((name) => !after.includes(name)))
      throw new IncompatibleConversation();
  }
  for (const field of [
    ...(modelChosen ? [] : (["model"] as const)),
    "tools",
    "mcp_servers",
    "skills",
    "multiagent",
  ] as const) {
    const pick = (value: AgentSnapshot) =>
      field === "tools" && upgrade
        ? withoutDevice(value.tools)
        : value[field];
    if (canonicalJson(pick(snapshot)) !== canonicalJson(pick(versioned)))
      throw new IncompatibleConversation();
  }
  identityBlock(snapshot.system);
  const system = toolsBlock(snapshot.system)
    ? systemWithTools(snapshot.system)
    : snapshot.system;
  return systemWithIdentity(system);
}
