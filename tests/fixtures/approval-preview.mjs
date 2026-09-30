// Isolated approval UI acceptance test: in-memory mock data only; never reads credentials or runs real tools.
// npm run build && node tests/fixtures/approval-preview.mjs
import express from "express";
import path from "node:path";

const app = express();
const queries = [
  "Shenzhen North to Shantou station high-speed rail fastest travel time 2025",
  "Shantou Nan'ao Bridge self-drive downtown to Nan'ao Island duration 2025",
  "Shantou Small Park old town sightseeing guide 2025 photo spots",
  "Nan'ao Island ring-island route Qing'ao Bay transport",
  "Shantou Chaoshan food restaurant recommendations",
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
      title: `Approval UI acceptance · ${name} (mock)`,
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
            description: "Unknown tool: keep the full parameters for review",
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
            input: { query: "A second independent approval request" },
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
                text: "Please help me plan a weekend trip from Shenzhen to Shantou and Nan'ao Island. (This page only mocks approvals.)",
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
    return res.status(409).json({
      error: "This mock request is not in the pending approval list.",
    });
  decisions.push({ session: req.params.id, ...req.body });
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (req.params.id === "approval-failure" && !value.failed) {
    value.failed = true;
    return res
      .status(503)
      .json({ error: "Mock submission failed; check the history and retry." });
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
          text: `Mock result: ${req.body.result === "allow" ? "allowed for this one time" : "denied"}; no real tool was executed.`,
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
  res
    .status(404)
    .json({ error: "This acceptance service never calls the cloud." }),
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
