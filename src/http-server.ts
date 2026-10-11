import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { MultiAIHub } from "./hub.js";
import { isSensitive } from "./sensitivity.js";
import { PROVIDERS, type Provider } from "./types.js";

type Options = { hub: Pick<MultiAIHub, "status" | "chat">; publicDir: string; generatedDir: string };
const MAX_MESSAGE = 12_000;
const MAX_BODY = 64_000;
const STATIC_FILES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
};
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function createHubServer({ hub, publicDir, generatedDir }: Options) {
  let busy = false;
  let recentRequests: number[] = [];
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const origin = localOrigin(request);
      if (!origin) throw new HttpError(403, "Only same-origin loopback requests are allowed.");
      const url = new URL(request.url ?? "/", origin);
      if (url.origin !== origin) throw new HttpError(403, "Invalid request origin.");
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(response, 200, { ...hub.status(), apiVersion: 1, mode: "local", maxMessageChars: MAX_MESSAGE });
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        if (request.headers["x-hub-request"] !== "console") throw new HttpError(403, "The X-Hub-Request: console header is required.");
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw new HttpError(415, "Use application/json.");
        // Reserve before reading the body so concurrent requests cannot race past the gate.
        if (busy) throw new HttpError(429, "A request is already running. Wait for it to finish.");
        const now = Date.now();
        recentRequests = recentRequests.filter((at) => now - at < 60_000);
        if (recentRequests.length >= 10) throw new HttpError(429, "Request limit reached. Try again in a minute.");
        busy = true;
        try {
          const { provider, message } = await readJson(request);
          if (typeof provider !== "string" || !(PROVIDERS as readonly string[]).includes(provider)) throw new HttpError(400, "Choose a valid provider.");
          if (typeof message !== "string" || !message.trim()) throw new HttpError(400, "Message is required.");
          if (message.length > MAX_MESSAGE) throw new HttpError(413, "Message exceeds 12,000 characters.");
          if (provider !== "ollama" && isSensitive(message)) throw new HttpError(403, "This message looks sensitive. Use a local model for private information.");
          if (!hub.status()[provider as Provider]) throw new HttpError(409, "Provider is not configured. Check your local .env.");
          recentRequests.push(now);
          try { return json(response, 200, await hub.chat(provider as Provider, message.trim())); }
          catch { throw new HttpError(502, "Provider request failed. Check the model, local service, credentials and quota. No automatic retry was made."); }
        } finally { busy = false; }
      }
      if (request.method === "GET" && url.pathname === "/runtime-config.js") {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        return response.end('export const mode = "local";\n');
      }
      if (request.method === "GET") {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (Object.hasOwn(STATIC_FILES, file)) return await serveFile(response, publicDir, file, STATIC_FILES[file]!);
        // Only generated PNG artifacts, never arbitrary files or directory listings.
        if (/^\/generated\/[0-9]+-[a-f0-9]{8}\.png$/.test(url.pathname)) return await serveFile(response, generatedDir, path.basename(url.pathname), "image/png");
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      const known = error instanceof HttpError;
      if (known && error.status === 429) response.setHeader("Retry-After", "60");
      json(response, known ? error.status : 500, { error: known ? error.message : "Request failed." });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

function localOrigin(request: IncomingMessage): string | undefined {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) return;
  const host = request.headers.host;
  const port = request.socket.localPort;
  if (!host || !["127.0.0.1", "localhost", "[::1]"].some((name) => host === `${name}:${port}` || (port === 80 && host === name))) return;
  const origin = `http://${host}`;
  if (request.headers.origin !== undefined && request.headers.origin !== origin) return;
  if (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"]))) return;
  return origin;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "Invalid JSON body."); }
}

async function serveFile(response: ServerResponse, root: string, relative: string, type: string) {
  try {
    const canonicalRoot = await realpath(root);
    const file = await realpath(path.join(root, relative));
    if (path.dirname(file) !== canonicalRoot) throw new HttpError(404, "Not found.");
    const bytes = await readFile(file);
    response.setHeader("Content-Type", type);
    response.end(bytes);
  } catch { throw new HttpError(404, "Not found."); }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}
