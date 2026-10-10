import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { MultiAIHub } from "./hub.js";
import { createHubServer } from "./http-server.js";

const server = createHubServer({
  hub: new MultiAIHub(),
  publicDir: fileURLToPath(new URL("../public/", import.meta.url)),
  generatedDir: path.join(config.projectRoot, "data/generated"),
});
server.on("error", () => {
  console.error("Could not start the local console. Check HOST/PORT and whether the port is already in use.");
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  const host = config.host === "::1" ? "[::1]" : config.host;
  console.log(`Multi-AI Hub: http://${host}:${config.port}`);
  console.log("Local single-user console. This address works only on this computer.");
});
