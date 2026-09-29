// 隔离的审批 UI 验收：只有内存模拟数据，不读取凭据、不执行真实工具。
// npm run build && node tests/fixtures/approval-preview.mjs
import express from "express";
import path from "node:path";

const app = express();
const queries = [
  "深圳北到汕头站 高铁 最快 多长时间 2025",
  "汕头 南澳大桥 自驾 市区到南澳岛 多久 2025",
  "汕头 小公园开埠区 游玩攻略 2025 打卡",
  "南澳岛 环岛路线 青澳湾 交通",
  "汕头 潮汕美食 餐厅推荐",
];
const cases = [
  "search",
  "fetch",
  "deny",
  "unknown",
  "failure",
  "batch",
  "mixed",
  "mcp",
];
const data = new Map(
  cases.map((name) => {
    const id = `approval-${name}`;
    const now = new Date().toISOString();
    const session = {
      id,
      title: `审批 UI 验收 · ${name}（模拟）`,
      category: "research",
      status: "idle",
      created_at: now,
      updated_at: now,
    };
    const tool = {
      id: `${id}-tool`,
      type: name === "mcp" ? "agent.mcp_tool_use" : "agent.tool_use",
      name: ["unknown", "deny"].includes(name)
        ? "custom.run"
        : name === "fetch"
          ? "web_fetch"
          : "web_search",
      input: ["unknown", "deny"].includes(name)
        ? {
            command: "echo 'UI fixture only'",
            description: "未知工具：保留完整参数供检查",
            nested: { enabled: true },
          }
        : name === "fetch"
          ? { url: "https://example.com/travel" }
          : {
              max_results: 8,
              search_request_list: queries.map((query) => ({ query })),
            },
      evaluated_permission: "ask",
    };
    const tools = ["batch", "mixed"].includes(name)
      ? [
          tool,
          {
            ...tool,
            id: `${id}-tool-2`,
            name: name === "mixed" ? "send_email" : "web_fetch",
            input: { query: "第二个独立审批请求" },
          },
        ]
      : [tool];
    return [
      id,
      {
        session,
        events: [
          {
            id: `${id}-user`,
            type: "user.message",
            content: [
              {
                type: "text",
                text: "请帮我规划深圳出发的汕头、南澳岛周末旅行。（本页面仅模拟审批）",
              },
            ],
          },
          ...tools,
          {
            id: `${id}-idle`,
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: tools.map((t) => t.id),
            },
          },
        ],
        pending: new Set(tools.map((t) => t.id)),
        failed: false,
      },
    ];
  }),
);
const decisions = [];
app.use(express.json());
app.get("/api/config", (_req, res) =>
  res.json({ mode: "demo", agentConfigured: true, authRequired: false }),
);
app.get("/api/sessions", (_req, res) =>
  res.json({ data: [...data.values()].map((v) => v.session) }),
);
app.get("/api/sessions/:id", (req, res) =>
  res.json(data.get(req.params.id)?.session),
);
app.get("/api/sessions/:id/events", (req, res) =>
  res.json({ data: data.get(req.params.id)?.events ?? [] }),
);
app.get("/api/sessions/:id/events/stream", (_req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  res.flushHeaders();
  res.write(": mock fixture\n\n");
});
app.get("/api/fixture/decisions", (_req, res) => res.json(decisions));
app.post("/api/sessions/:id/events", async (req, res) => {
  const value = data.get(req.params.id);
  if (
    !value ||
    req.body.type !== "user.tool_confirmation" ||
    !value.pending.has(req.body.tool_use_id) ||
    !["allow", "deny"].includes(req.body.result)
  )
    return res.status(409).json({ error: "此模拟请求不在待审批列表中。" });
  decisions.push({ session: req.params.id, ...req.body });
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (req.params.id === "approval-failure" && !value.failed) {
    value.failed = true;
    return res.status(503).json({ error: "模拟提交失败，请核对历史后重试。" });
  }
  value.pending.delete(req.body.tool_use_id);
  value.events.push(
    {
      id: `confirmation-${decisions.length}`,
      ...req.body,
      ...(req.body.automatic ? { approval_source: "automatic" } : {}),
    },
    {
      id: `message-${decisions.length}`,
      type: "agent.message",
      content: [
        {
          type: "text",
          text: `模拟结果：已${req.body.result === "allow" ? "允许这一次" : "拒绝"}，没有执行真实工具。`,
        },
      ],
    },
  );
  if (!value.pending.size)
    value.events.push({
      id: `done-${decisions.length}`,
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    });
  res.json({ data: value.events.slice(-3) });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "此验收服务不调用云端。" }),
);
app.use(express.static(path.resolve("dist")));
const server = app.listen(0, "127.0.0.1", () =>
  console.log(
    `Approval fixture: http://127.0.0.1:${server.address().port}/#/task/approval-search`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
