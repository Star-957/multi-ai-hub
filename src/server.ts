import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { config } from "./config.js";
import { MultiAIHub } from "./hub.js";
import { PROVIDERS, type Provider } from "./types.js";

const hub = new MultiAIHub();
const publicDir = path.resolve("public");
const generatedDir = path.resolve("data/generated");

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json(response, 200, hub.status());
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(request);
      const provider = body.provider;
      const message = body.message;
      if (!isProvider(provider)) return json(response, 400, { error: "Invalid provider" });
      if (typeof message !== "string" || message.trim().length === 0) {
        return json(response, 400, { error: "Message is required" });
      }
      if (message.length > 50_000) return json(response, 413, { error: "Message is too long" });
      const result = await hub.chat(provider, message.trim());
      return json(response, 200, result);
    }
    if (request.method === "GET" && url.pathname.startsWith("/generated/")) {
      return serveFile(response, generatedDir, url.pathname.slice("/generated/".length));
    }
    if (request.method === "GET") {
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      return serveFile(response, publicDir, relative);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(response, message.includes("too large") ? 413 : 500, { error: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Multi-AI Hub running at http://${config.host}:${config.port}`);
  console.log("Configured:", hub.status());
});

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function serveFile(response: ServerResponse, root: string, relative: string) {
  const normalized = path.normalize(relative).replace(/^([.][.][/\\])+/, "");
  const file = path.resolve(root, normalized);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!file.startsWith(rootPrefix)) return json(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(file);
    if (!info.isFile()) return json(response, 404, { error: "Not found" });
  } catch {
    return json(response, 404, { error: "Not found" });
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(file));
  response.setHeader("Cache-Control", file.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
  // Attach an error handler BEFORE piping (audit 2026-06-29): .pipe() does not forward source
  // errors, so an async ReadStream error (file removed/unreadable between stat and read, EIO) would
  // otherwise surface as an uncaughtException and crash the whole hub process.
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!response.headersSent) json(response, 500, { error: "Read failed" });
    else response.destroy();
  });
  stream.pipe(response);
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    }[extension] ?? "application/octet-stream"
  );
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );
}
