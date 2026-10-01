// veFaaS native Node.js function. A timer trigger invokes it over HTTP; each
// POST sends one signed scheduler trigger to the Open Muse service. No request
// content is read or logged, and no user data passes through this function.
import { createServer } from "node:http";
import { trigger } from "./trigger.mjs";

const port = Number(process.env.PORT || 8000);

createServer(async (request, response) => {
  request.resume();
  if (request.method !== "POST") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  let status = 0;
  try {
    status = await trigger(process.env);
  } catch {
    status = 0;
  }
  const ok = status >= 200 && status < 300;
  console.log(`scheduler trigger: ${status || "unreachable"}`);
  response.writeHead(ok ? 200 : 502, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok, status }));
}).listen(port, "0.0.0.0");
