import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHubServer } from "../src/http-server.js";
import { readHttpConfig } from "../src/http-config.js";
import type { MultiAIHub } from "../src/hub.js";
import type { AgentResult } from "../src/types.js";

const result: AgentResult = { provider: "ollama", text: "Test reply", trace: [], artifacts: [] };
async function fixture(run: (port: number, calls: string[]) => Promise<void>, chat?: () => Promise<AgentResult>) {
  const calls: string[] = [];
  const hub = {
    status: () => ({ ollama: true, openai: true, claude: false, gemini: false }),
    chat: async (_provider: unknown, message: string) => { calls.push(message); return chat ? chat() : result; },
  } as unknown as Pick<MultiAIHub, "status" | "chat">;
  const server = createHubServer({ hub, publicDir: fileURLToPath(new URL("../public", import.meta.url)), generatedDir: fileURLToPath(new URL("../data/generated", import.meta.url)) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try { await run(address.port, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function call(port: number, route: string, body?: string, headers: Record<string, string | undefined> = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: route, method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Hub-Request": "console", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const prompt = JSON.stringify({ provider: "ollama", message: "Explain sorting" });

test("only loopback hosts and valid ports may be configured", () => {
  assert.deepEqual(readHttpConfig({}), { host: "127.0.0.1", port: 8787 });
  assert.equal(readHttpConfig({ HOST: "localhost", PORT: "9000" }).host, "127.0.0.1");
  assert.equal(readHttpConfig({ HOST: "::1" }).host, "::1");
  for (const HOST of ["0.0.0.0", "::", "192.168.1.1", "example.com", ""]) assert.throws(() => readHttpConfig({ HOST }));
  for (const PORT of ["-1", "0", "65536", "1.5", "NaN", ""]) assert.throws(() => readHttpConfig({ PORT }));
});

test("clean checkout serves console/assets and versioned local status", async () => fixture(async (port) => {
  for (const route of ["/", "/styles.css", "/app.js", "/runtime-config.js"]) assert.equal((await call(port, route)).status, 200, route);
  const home = await call(port, "/");
  assert.match(home.body, /Multi-AI Hub/);
  assert.match(String(home.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(home.headers["cache-control"], "no-store");
  assert.match((await call(port, "/runtime-config.js")).body, /"local"/);
  const status = JSON.parse((await call(port, "/api/status")).body);
  assert.equal(status.apiVersion, 1);
  assert.equal(status.mode, "local");
}));

test("host rebinding and cross-site API requests never reach providers", async () => fixture(async (port, calls) => {
  for (const headers of [
    { Host: `evil.example:${port}` }, { Origin: "https://evil.example" }, { Origin: "null" },
    { Origin: "http://127.0.0.1:1" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" },
    { "X-Hub-Request": "" },
  ]) assert.equal((await call(port, "/api/chat", prompt, headers)).status, 403);
  assert.equal((await call(port, "/api/status", undefined, { Origin: "https://evil.example" })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await call(port, "/api/chat", prompt, { Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" })).status, 200);
}));

test("bad content, unavailable providers and sensitive cloud requests fail closed", async () => fixture(async (port, calls) => {
  assert.equal((await call(port, "/api/chat", prompt, { "Content-Type": "text/plain" })).status, 415);
  for (const body of ["{", "[]", "null", JSON.stringify({ provider: "bad", message: "test" }), JSON.stringify({ provider: "ollama", message: " " })]) assert.equal((await call(port, "/api/chat", body)).status, 400);
  assert.equal((await call(port, "/api/chat", JSON.stringify({ provider: "ollama", message: "a".repeat(12001) }))).status, 413);
  assert.equal((await call(port, "/api/chat", JSON.stringify({ provider: "ollama", message: "a".repeat(70000) }))).status, 413);
  assert.equal((await call(port, "/api/chat", JSON.stringify({ provider: "claude", message: "Explain sorting" }))).status, 409);
  assert.equal((await call(port, "/api/chat", JSON.stringify({ provider: "openai", message: "my passport details" }))).status, 403);
  assert.equal(calls.length, 0);
  const good = await call(port, "/api/chat", JSON.stringify({ provider: "ollama", message: " my passport details " }));
  assert.equal(good.status, 200);
  assert.deepEqual(calls, ["my passport details"]);
}));

test("private paths and non-PNG generated artifacts cannot be fetched", async () => fixture(async (port) => {
  for (const route of ["/.env", "/.git/config", "/src/config.ts", "/data/", "/generated/secret.txt", "/generated/1-12345678.svg", "/%2e%2e/.env", "/public/../.env"]) {
    assert.equal((await call(port, route)).status, 404, route);
  }
}));

test("provider exceptions are redacted and the busy slot is released", async () => fixture(async (port, calls) => {
  for (let i = 0; i < 2; i++) {
    const reply = await call(port, "/api/chat", prompt);
    assert.equal(reply.status, 502);
    assert.doesNotMatch(reply.body, /sensitive-fixture-value/);
  }
  assert.equal(calls.length, 2);
}, async () => { throw new Error("sensitive-fixture-value"); }));

test("concurrent and excessive requests cannot fan out to providers", async () => {
  let finish: (value: AgentResult) => void = () => {};
  let started: () => void = () => {};
  const pending = new Promise<AgentResult>((resolve) => { finish = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  await fixture(async (port, calls) => {
    const first = call(port, "/api/chat", prompt);
    await ready;
    try { assert.equal((await call(port, "/api/chat", prompt)).status, 429); }
    finally { finish(result); }
    assert.equal((await first).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await call(port, "/api/chat", prompt)).status, 200);
    const limit = await call(port, "/api/chat", prompt);
    assert.equal(limit.status, 429);
    assert.equal(limit.headers["retry-after"], "60");
    assert.equal(calls.length, 10);
  }, () => { started(); return pending; });
});
