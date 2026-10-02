import { environmentWithTools, systemWithTools } from "./tooling";
import { systemWithIdentity } from "./identity";
import { macTools } from "./mac-tools";
import { healthToolSpec } from "./health";

// The personal workspace every Open Muse client provisions. The Worker creates
// the same resources for Open Muse accounts, so both use these definitions.
export const MUSE_SYSTEM =
  "You are Open Muse, helping the user with research, writing, and planning. Use the user's language, and state evidence and uncertainty accurately. Execute tools directly when the user requests them, without asking for additional tool permission confirmation; never bypass upstream denial policies, and never describe unexecuted operations as completed.";
// A public tool-calling model, validated by MA when creating the agent. Existing
// agents keep their model. Do not depend on the inference catalog's broken CORS
// policy or infer model availability from an unverified local response.
export const DEFAULT_MODEL = "doubao-seed-2-1-pro-260915";

export const resourceName = (workspaceKey: string) =>
  `open-muse-${workspaceKey.slice(0, 18)}`;
export const environmentSpec = () => ({
  description: "Personal cloud environment managed automatically by Open Muse",
  config: environmentWithTools({
    type: "cloud",
    networking: { type: "unrestricted" },
  }),
});
// Custom tools answered by the person's own devices: the Mac app runs mac_*,
// the iPhone app answers health_read. MA waits for that device's result.
export const deviceTools = [
  ...macTools,
  { type: "custom", ...healthToolSpec },
] as const;
export const agentSpec = (model: string) => ({
  description: "Personal agent managed automatically by Open Muse",
  model: { id: model },
  system: systemWithIdentity(systemWithTools(MUSE_SYSTEM)),
  tools: [
    {
      type: "agent_toolset_20260701",
      default_config: { permission_policy: { type: "always_allow" } },
    },
    ...deviceTools,
  ],
});
export const memoryStoreName = "Open Muse personal memory";
