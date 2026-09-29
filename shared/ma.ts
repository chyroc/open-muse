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
    label: "智能体",
    hint: "模型、工具、MCP、多 Agent 与版本",
    match: /Agent/,
  },
  {
    id: "environments",
    label: "运行环境",
    hint: "云端沙箱、网络策略与预装依赖",
    match: /Environment/,
  },
  {
    id: "sessions",
    label: "会话与事件",
    hint: "完整配置、资源挂载与执行历史",
    match: /Session/,
  },
  {
    id: "memory",
    label: "记忆",
    hint: "记忆库、目录浏览与批量导入",
    match: /Memor/,
  },
  {
    id: "vaults",
    label: "连接与凭据",
    hint: "Vault、凭据校验与 MCP OAuth",
    match: /Vault|Credential|OAuth/,
  },
  {
    id: "skills",
    label: "技能",
    hint: "上传技能包与适用性评估",
    match: /Skill/,
  },
  { id: "files", label: "文件", hint: "上传、元信息与删除", match: /File/ },
];
export const labels: Record<string, string> = {
  Create: "创建",
  List: "列表",
  Get: "查看",
  Update: "更新",
  Delete: "删除",
  CreateSkill: "上传技能包",
  ListAgentVersions: "版本记录",
  BatchCreateMemories: "批量写入",
  CreateSessionResource: "挂载文件",
  ListSessionResources: "已挂载资源",
  ListSessionEvents: "事件历史",
  SendSessionEvents: "发送事件",
  StreamSessionEvents: "实时事件流",
  ValidateCredential: "校验凭据",
  CreateVaultOAuthFlow: "连接 MCP OAuth",
  ListOAuthProviders: "OAuth 提供方",
  ListSessionsWithEnvID: "按环境查会话",
  ListMemoryStoreCreators: "记忆库创建人",
  UploadFile: "上传文件",
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
      name: "Open Muse 助手",
      model: { id: "请填写可用的模型或接入点 ID" },
      system: "准确回答；引用来源；执行外部操作前请求确认。",
      tools: [
        {
          type: "agent_toolset_20260401",
          default_config: { permission_policy: { type: "always_allow" } },
        },
      ],
    },
    UpdateAgent: { version: 1, description: "请先查看当前版本，再更新" },
    CreateEnvironment: {
      name: "Open Muse 云环境",
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
    UpdateEnvironment: { description: "更新环境说明" },
    CreateSession: {
      agent: "",
      environment_id: "",
      title: "新任务",
      resources: [],
      vault_ids: [],
    },
    UpdateSession: { title: "更新任务名称" },
    CreateSessionResource: { type: "file", file_id: "" },
    CreateVault: { display_name: "我的连接" },
    UpdateVault: { display_name: "我的连接" },
    CreateCredential: {
      display_name: "MCP 连接",
      auth: {
        type: "static_bearer",
        mcp_server_url: "https://example.com/mcp",
        token: "",
      },
    },
    UpdateCredential: { display_name: "更新连接名称" },
    CreateMemoryStore: {
      name: "个人偏好",
      description: "供 Agent 参考的长期信息",
    },
    UpdateMemoryStore: { description: "更新记忆库说明" },
    CreateMemory: { path: "preferences.md", content: "请用简体中文回答。" },
    UpdateMemory: { content: "更新记忆内容" },
    BatchCreateMemories: {
      items: [{ path: "preferences.md", content: "请用简体中文回答。" }],
      on_conflict: "fail",
    },
    SendSessionEvents: {
      events: [
        { type: "user.message", content: [{ type: "text", text: "你好" }] },
      ],
    },
    UploadFile: { purpose: "agent" },
    CreateSkill: { display_title: "我的技能" },
    CreateVaultOAuthFlow: {
      VaultId: "",
      DisplayName: "MCP 连接",
      McpServerUrl: "",
      RedirectUrl: "",
      Source: "open-muse",
    },
  };
  return examples[id] ?? {};
}
