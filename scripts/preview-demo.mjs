import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const types = { "index.html": "text/html", "styles.css": "text/css", "app.js": "text/javascript", "runtime-config.js": "text/javascript" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const name = url.pathname.replace(/^\/multi-ai-hub/, "").slice(1) || "index.html";
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" || !Object.hasOwn(types, name)) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(`../dist/demo/${name}`, import.meta.url));
    response.setHeader("Content-Type", `${types[name]}; charset=utf-8`);
    response.end(bytes);
  } catch { response.writeHead(404).end("Run pnpm build:demo first."); }
});
server.listen(4173, "127.0.0.1", () => console.log("Demo preview: http://127.0.0.1:4173/multi-ai-hub/"));
