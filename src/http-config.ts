/** The provider hub has no remote-user authentication. Keep its listener on loopback. */
export function readHttpConfig(env: NodeJS.ProcessEnv) {
  const requestedHost = env.HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(requestedHost)) {
    throw new Error("HOST must be 127.0.0.1, localhost, or ::1. Use the static demo for public hosting.");
  }
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return { host: requestedHost === "localhost" ? "127.0.0.1" : requestedHost, port };
}
