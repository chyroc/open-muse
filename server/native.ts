// Mac App 内嵌服务。独立于 tsx、npm 和用户 shell 环境启动。
import { createApp } from "./app";
import { loadConfig } from "./config";
async function main() {
  const config = loadConfig();
  const { app, close } = await createApp(config);
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object")
      process.stdout.write(
        JSON.stringify({ ready: true, port: address.port }) + "\n",
      );
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      close();
      server.close();
      server.closeAllConnections();
    });
  server.on("error", () => {
    process.stderr.write("Local service could not start.\n");
    process.exit(1);
  });
}
main().catch(() => {
  process.stderr.write(
    "Local service initialization failed. Check Application Support/Open Muse permissions.\n",
  );
  process.exit(1);
});
