// Open Muse runs on a Managed Agents (MA) service: persisted agents and
// environments, sessions with an event stream, and memory stores. Volcano Ark
// is the default and reference backend. Claude Managed Agents offers the same
// resource model and can stand in for it; where Ark has something Claude does
// not, the Claude backend leaves it out instead of emulating it.
export type MAProviderId = "ark" | "claude";

export interface MACredential {
  apiKey: string;
  project: string;
}

export interface MAProvider {
  id: MAProviderId;
  name: string;
  // Base URL of the MA REST API; paths such as `/sessions` are appended.
  baseUrl: string;
  // The origin requests go to, for allowlists and connection policies.
  origin: string;
  // Response header carrying the request ID that support can trace.
  requestIdHeader: string;
  // Model for newly created agents.
  defaultModel: string;
  // Built-in tool set the personal agent is created with.
  agentToolset: string;
  // Ark-only: a per-conversation model and thinking-level override, chosen
  // from the Ark model catalog.
  modelChoice: boolean;
  // Ark-only: API keys scoped to a named project.
  projects: boolean;
  headers(credential: MACredential, path: string): Record<string, string>;
}

export const arkProvider: MAProvider = {
  id: "ark",
  name: "Ark",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  origin: "https://ark.cn-beijing.volces.com",
  requestIdHeader: "x-request-id",
  // A public tool-calling model, validated by MA when creating the agent.
  // Existing agents keep their model.
  defaultModel: "doubao-seed-2-1-pro-260915",
  agentToolset: "agent_toolset_20260701",
  modelChoice: true,
  projects: true,
  headers: ({ apiKey, project }) => ({
    Authorization: `Bearer ${apiKey}`,
    ...(project ? { "X-Project-Name": project } : {}),
  }),
};

export const claudeProvider: MAProvider = {
  id: "claude",
  name: "Claude",
  baseUrl: "https://api.anthropic.com/v1",
  origin: "https://api.anthropic.com",
  requestIdHeader: "request-id",
  defaultModel: "claude-opus-5-5",
  agentToolset: "agent_toolset_20260401",
  modelChoice: false,
  projects: false,
  headers: ({ apiKey }, path) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    // Memory stores take their own beta; sending both is rejected.
    "anthropic-beta": path.startsWith("/memory_stores")
      ? "agent-memory-2026-07-22"
      : "managed-agents-2026-04-01",
    // The apps call the API straight from their WebView.
    "anthropic-dangerous-direct-browser-access": "true",
  }),
};

const providers: Record<MAProviderId, MAProvider> = {
  ark: arkProvider,
  claude: claudeProvider,
};

// The backend named by build or deployment configuration; Ark when unset.
export function maProvider(id: string | undefined): MAProvider {
  if (!id) return arkProvider;
  const provider = providers[id as MAProviderId];
  if (!provider || !Object.hasOwn(providers, id))
    throw new Error(`Unknown Managed Agents provider "${id}".`);
  return provider;
}
