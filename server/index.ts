import { loadConfig } from "./config";
import { createApp } from "./app";

const config = loadConfig();
const { app, close } = await createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Open Muse API: http://${config.host}:${config.port} [${config.mode}]`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    close();
    server.close();
    server.closeAllConnections();
  });
