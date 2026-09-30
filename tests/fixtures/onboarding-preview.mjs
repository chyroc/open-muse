// Isolated UI acceptance service: serves only in-memory mock responses; never reads credentials or calls the cloud.
// Run node tests/fixtures/onboarding-preview.mjs after npm run build.
import express from "express";
import path from "node:path";
const app = express();
const projects = [
  "UI acceptance project (mock, no cloud writes)",
  "Another, longer project name used to check the selector layout",
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
    return res
      .status(400)
      .json({ error: "Please choose the UI acceptance project." });
  connected = true;
  startedAt = Date.now();
  res.json({ ready: true, project: projects[0] });
});
app.get("/api/workspace", (_req, res) =>
  res.json({
    state: Date.now() - startedAt < 1500 ? "preparing" : "ready",
    message:
      Date.now() - startedAt < 1500
        ? "Preparing the mock workspace…"
        : "UI acceptance: the mock workspace is ready; no real cloud resources were created.",
  }),
);
app.use("/api", (_req, res) =>
  res
    .status(404)
    .json({ error: "This acceptance service performs no real actions." }),
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
