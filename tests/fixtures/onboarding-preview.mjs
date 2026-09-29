// 隔离的 UI 验收服务：只提供内存中的模拟响应，不读取凭据、不调用云端。
// npm run build 后执行 node tests/fixtures/onboarding-preview.mjs。
import express from "express";
import path from "node:path";
const app = express();
const projects = [
  "UI 验收项目（模拟，无云端写入）",
  "另一个较长的项目名称，用于检查选择框布局",
];
let connected = false;
let startedAt = 0;
app.use(express.json());
app.get("/api/config", (_req, res) =>
  res.json({ mode: "demo", agentConfigured: connected, authRequired: false }),
);
app.get("/api/sessions", (_req, res) => res.json({ data: [] }));
app.get("/api/auth/status", (_req, res) =>
  res.json({
    loggedIn: true,
    ready: connected,
    project: connected ? projects[0] : undefined,
  }),
);
app.get("/api/auth/projects", (_req, res) => res.json({ projects }));
app.post("/api/auth/project", (req, res) => {
  if (req.body.project !== projects[0] || req.body.confirm !== true)
    return res.status(400).json({ error: "请选择 UI 验收项目。" });
  connected = true;
  startedAt = Date.now();
  res.json({ ready: true, project: projects[0] });
});
app.get("/api/workspace", (_req, res) =>
  res.json({
    state: Date.now() - startedAt < 1500 ? "preparing" : "ready",
    message:
      Date.now() - startedAt < 1500
        ? "正在准备模拟工作空间…"
        : "UI 验收：模拟工作空间已就绪，未创建真实云端资源。",
  }),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "此验收服务不执行真实操作。" }),
);
app.use(express.static(path.resolve("dist")));
const server = app.listen(0, "127.0.0.1", () =>
  console.log(
    `UI fixture: http://127.0.0.1:${server.address().port}/#/settings`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
