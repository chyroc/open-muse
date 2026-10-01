#!/usr/bin/env node
// Creates or updates the veFaaS scheduler function and its timer trigger with
// the Volcengine CLI (`ve`). Run from any directory:
//
//   MUSE_API_ORIGIN=https://api.example.com \
//   SCHEDULER_TRIGGER_SECRET=... \
//   VOLC_PROJECT=default VOLC_REGION=ap-southeast-1 \
//   node server/deploy/volcengine/deploy-scheduler.mjs
//
// Requires `ve` signed in (for example `ve login`) and the `zip` command. The
// secret is passed to veFaaS as a function environment variable and is never
// printed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiOrigin } from "./scheduler/trigger.mjs";

const NAME = process.env.SCHEDULER_FUNCTION_NAME || "open-muse-scheduler";
const REGION = process.env.VOLC_REGION || "ap-southeast-1";
const PROJECT = process.env.VOLC_PROJECT || "default";
const CRONTAB = process.env.SCHEDULER_CRONTAB || "*/5 * * * *";
const origin = apiOrigin(process.env.MUSE_API_ORIGIN);
const secret = process.env.SCHEDULER_TRIGGER_SECRET ?? "";
if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret))
  throw new Error("Set SCHEDULER_TRIGGER_SECRET (43+ URL-safe characters).");

function api(action, body) {
  const output = execFileSync(
    "ve",
    [
      "vefaas",
      action,
      "--version",
      "2024-06-06",
      "--endpoint",
      "open.volcengineapi.com",
      "--region",
      REGION,
      "--method",
      "POST",
      "--body",
      JSON.stringify(body),
      "--force",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // `ve` may print notices before the JSON document.
  return JSON.parse(output.slice(output.indexOf("{"))).Result;
}

const source = (() => {
  const dir = mkdtempSync(join(tmpdir(), "open-muse-scheduler-"));
  const zip = join(dir, "function.zip");
  try {
    execFileSync(
      "zip",
      ["-q", "-X", zip, "run.sh", "server.mjs", "trigger.mjs"],
      { cwd: join(dirname(fileURLToPath(import.meta.url)), "scheduler") },
    );
    return readFileSync(zip).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const config = {
  Description: "Open Muse background schedule clock",
  Runtime: "native-node20/v1",
  Command: "./run.sh",
  Port: 8000,
  MemoryMB: 512,
  RequestTimeout: 60,
  MaxConcurrency: 10,
  SourceType: "zip",
  Source: source,
  Envs: [
    { Key: "MUSE_API_ORIGIN", Value: origin },
    { Key: "SCHEDULER_TRIGGER_SECRET", Value: secret },
  ],
};

const existing = api("ListFunctions", { PageSize: 100 }).Items?.find(
  (item) => item.Name === NAME,
);
const id = existing
  ? (api("UpdateFunction", { Id: existing.Id, ...config }), existing.Id)
  : api("CreateFunction", { Name: NAME, ProjectName: PROJECT, ...config }).Id;
console.log(`${existing ? "Updated" : "Created"} function ${id} in ${REGION}.`);

api("Release", {
  FunctionId: id,
  RevisionNumber: 0,
  Description: "deploy-scheduler",
  MaxInstance: 2,
  TargetTrafficWeight: 100,
});
for (let i = 0; ; i++) {
  const status = api("GetReleaseStatus", { FunctionId: id }).Status;
  if (status === "done") break;
  if (status === "failed" || i > 60) throw new Error(`Release ${status}.`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.log("Released.");

const timer = api("ListTriggers", { FunctionId: id }).Items?.find(
  (item) => item.Type === "timer",
);
if (timer)
  api("UpdateTimer", {
    FunctionId: id,
    Id: timer.Id,
    Crontab: CRONTAB,
    Enabled: true,
  });
else
  api("CreateTimer", {
    FunctionId: id,
    Name: "open-muse-schedule-clock",
    Description: "Advance Open Muse background work",
    Crontab: CRONTAB,
    Enabled: true,
    EnableConcurrency: false,
    Retries: 0,
    Payload: "{}",
  });
console.log(`Timer ${CRONTAB} is enabled.`);
