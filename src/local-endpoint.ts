// Seats advertised as local must never silently route private prompts off-machine.
export function readOllamaEndpoint(value = "http://127.0.0.1:11434"): string {
  if (value === "") return ""; // Explicitly disable local seats.
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("OLLAMA_URL must be a loopback HTTP(S) origin."); }
  if (!["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OLLAMA_URL must be a loopback HTTP(S) origin without credentials or extra paths.");
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}
