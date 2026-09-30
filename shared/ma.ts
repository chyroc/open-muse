import contract from "./ma-contract.json";
export interface MAField {
  name: string;
  in: string;
  type: string;
  required: boolean;
}
export interface MAOperation {
  id: string;
  method: string;
  path: string;
  transport: string;
  fields: MAField[];
}
export const operations: MAOperation[] = [
  ...contract,
  {
    id: "UploadFile",
    method: "POST",
    path: "/files",
    transport: "rest",
    fields: [
      { name: "purpose", in: "form", type: "string", required: true },
      { name: "url", in: "form", type: "string", required: false },
      { name: "expire_at", in: "form", type: "integer", required: false },
      { name: "tos", in: "form", type: "object", required: false },
    ],
  },
  ...["GetFile", "DeleteFile"].map((id) => ({
    id,
    method: id === "GetFile" ? "GET" : "DELETE",
    path: "/files/:id",
    transport: "rest",
    fields: [{ name: "id", in: "path", type: "string", required: true }],
  })),
];
export const groups = [
  {
    id: "agents",
    label: "Agents",
    hint: "Models, tools, MCP, multi-agent, and versions",
    match: /Agent/,
  },
  {
    id: "environments",
    label: "Environments",
    hint: "Cloud sandbox, network policy, and preinstalled dependencies",
    match: /Environment/,
  },
  {
    id: "sessions",
    label: "Sessions and events",
    hint: "Full configuration, resource mounts, and execution history",
    match: /Session/,
  },
  {
    id: "memory",
    label: "Memory",
    hint: "Memory stores, directory browsing, and bulk import",
    match: /Memor/,
  },
  {
    id: "vaults",
    label: "Connections and credentials",
    hint: "Vaults, credential validation, and MCP OAuth",
    match: /Vault|Credential|OAuth/,
  },
  {
    id: "skills",
    label: "Skills",
    hint: "Upload skill packages and applicability evaluation",
    match: /Skill/,
  },
  {
    id: "files",
    label: "Files",
    hint: "Upload, metadata, and deletion",
    match: /File/,
  },
];
export const labels: Record<string, string> = {
  Create: "Create",
  List: "List",
  Get: "View",
  Update: "Update",
  Delete: "Delete",
  CreateSkill: "Upload skill package",
  ListAgentVersions: "Version history",
  BatchCreateMemories: "Bulk write",
  CreateSessionResource: "Mount file",
  ListSessionResources: "Mounted resources",
  ListSessionEvents: "Event history",
  SendSessionEvents: "Send event",
  StreamSessionEvents: "Real-time event stream",
  ValidateCredential: "Validate credential",
  CreateVaultOAuthFlow: "Connect MCP OAuth",
  ListOAuthProviders: "OAuth providers",
  ListSessionsWithEnvID: "List sessions by environment",
  ListMemoryStoreCreators: "Memory store creators",
  UploadFile: "Upload file",
};
export function operationLabel(id: string) {
  return (
    labels[id] ??
    Object.entries(labels).find(([key]) => id.startsWith(key))?.[1] ??
    id
  );
}
export function exampleFor(id: string): Record<string, unknown> {
  const examples: Record<string, Record<string, unknown>> = {
    CreateAgent: {
      name: "Open Muse assistant",
      model: { id: "Fill in an available model or endpoint ID" },
      system:
        "Answer accurately; cite sources; ask for confirmation before taking external actions.",
      tools: [
        {
          type: "agent_toolset_20260401",
          default_config: { permission_policy: { type: "always_allow" } },
        },
      ],
    },
    UpdateAgent: {
      version: 1,
      description: "Review the current version before updating",
    },
    CreateEnvironment: {
      name: "Open Muse cloud environment",
      config: {
        type: "cloud",
        networking: {
          type: "limited",
          allow_mcp_servers: true,
          allow_package_managers: true,
          allowed_hosts: [],
        },
      },
    },
    UpdateEnvironment: { description: "Update the environment description" },
    CreateSession: {
      agent: "",
      environment_id: "",
      title: "New task",
      resources: [],
      vault_ids: [],
    },
    UpdateSession: { title: "Update task name" },
    CreateSessionResource: { type: "file", file_id: "" },
    CreateVault: { display_name: "My connection" },
    UpdateVault: { display_name: "My connection" },
    CreateCredential: {
      display_name: "MCP connection",
      auth: {
        type: "static_bearer",
        mcp_server_url: "https://example.com/mcp",
        token: "",
      },
    },
    UpdateCredential: { display_name: "Update connection name" },
    CreateMemoryStore: {
      name: "Personal preferences",
      description: "Long-term information for the agent to reference",
    },
    UpdateMemoryStore: { description: "Update the memory store description" },
    CreateMemory: {
      path: "preferences.md",
      content: "Please answer in English.",
    },
    UpdateMemory: { content: "Update memory content" },
    BatchCreateMemories: {
      items: [{ path: "preferences.md", content: "Please answer in English." }],
      on_conflict: "fail",
    },
    SendSessionEvents: {
      events: [
        { type: "user.message", content: [{ type: "text", text: "Hello" }] },
      ],
    },
    UploadFile: { purpose: "agent" },
    CreateSkill: { display_title: "My skill" },
    CreateVaultOAuthFlow: {
      VaultId: "",
      DisplayName: "MCP connection",
      McpServerUrl: "",
      RedirectUrl: "",
      Source: "open-muse",
    },
  };
  return examples[id] ?? {};
}
