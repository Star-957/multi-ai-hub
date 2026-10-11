import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import test from "node:test";

// Isolate configuration before imports. No real credentials, CLI login or inference.
process.env = {
  SystemRoot: process.env.SystemRoot,
  NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT,
  DOTENV_CONFIG_PATH: path.join(os.tmpdir(), "hub-privacy-test-no-env"),
  CLAUDE_CLI_PATH: path.join(os.tmpdir(), "hub-privacy-test-no-cli"),
  MULTI_AI_ROOT: process.cwd(), CLAUDE_TRANSPORT: "api", HOST: "127.0.0.1", PORT: "8787",
  OPENAI_API_KEY: "synthetic-only", GEMINI_API_KEY: "synthetic-only", OPENAI_IMAGE_ENABLED: "true",
};

// SDK clients capture fetch in their constructors, including the MCP singleton.
// Install one dispatcher before importing any clients; it never forwards to native fetch.
const originalFetch = globalThis.fetch;
let fetchFixture: typeof fetch | undefined;
let fetchCalls = 0;
let unexpectedFetchCalls = 0;
const fetchRequests: Parameters<typeof fetch>[] = [];
globalThis.fetch = async (...args) => {
  fetchCalls++;
  fetchRequests.push(args);
  if (!fetchFixture) {
    unexpectedFetchCalls++;
    throw new Error("Unexpected network request");
  }
  return fetchFixture(...args);
};
test.beforeEach(() => {
  fetchFixture = undefined;
  fetchCalls = 0;
  unexpectedFetchCalls = 0;
  fetchRequests.length = 0;
});
test.afterEach(() => {
  assert.equal(unexpectedFetchCalls, 0, "all provider requests must have an explicit fixture");
});
test.after(() => { globalThis.fetch = originalFetch; });

const { MultiAIHub } = await import("../src/hub.js");
const { runCouncil } = await import("../src/council.js");
const { GeminiAdapter } = await import("../src/providers/gemini.js");
const { ImageGenerator } = await import("../src/image-generator.js");
const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
type Handler = (args: Record<string, unknown>) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const originalRegister = McpServer.prototype.registerTool;
const originalConnect = McpServer.prototype.connect;
try {
  McpServer.prototype.registerTool = function(name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as Handler);
    return {} as never;
  };
  McpServer.prototype.connect = async function() {};
  await import("../src/mcp-server.js");
} finally {
  McpServer.prototype.registerTool = originalRegister;
  McpServer.prototype.connect = originalConnect;
}
const invoke = async (name: string, args: Record<string, unknown>) => {
  const handler = handlers.get(name);
  assert.ok(handler, `missing tool: ${name}`);
  return handler(args);
};
const sentinel = "synthetic-diagnostic-must-not-escape";

test("benign council reaches Gemini while sensitive direct and council requests stay blocked", async () => {
  const originalRun = GeminiAdapter.prototype.run;
  let calls = 0;
  GeminiAdapter.prototype.run = async function(_prompt, context) {
    calls++;
    return { provider: "gemini", text: JSON.stringify({ verdict: "PASS", new_information: "Synthetic independent point about complexity", risk: "LOW" }), artifacts: [], trace: context.trace };
  };
  try {
    const hub = new MultiAIHub();
    const council = await runCouncil(hub, { prompt: "Compare sorting algorithms", mode: "quick", maxSeats: 1 });
    assert.equal(council.reviews[0]?.seat, "gemini");
    assert.equal(council.reviews[0]?.ok, true);
    assert.equal(council.reviews.length, 1);
    assert.equal(calls, 1);
    assert.equal(fetchCalls, 0);
    await assert.rejects(hub.chat("gemini", "my passport details"), /Sensitive content/);
    fetchFixture = async () => new Response(JSON.stringify({ message: { content: JSON.stringify({
      verdict: "PASS", new_information: "Synthetic local review stays on the local route", risk: "LOW",
    }) } }));
    const privateCouncil = await runCouncil(hub, { prompt: "my passport details", mode: "quick", maxSeats: 1 });
    assert.equal(privateCouncil.cloud_used, false);
    assert.equal(privateCouncil.reviews[0]?.ok, true);
    assert.equal(calls, 1);
    assert.deepEqual(fetchRequests.map(([input]) => String(input)), ["http://127.0.0.1:11434/api/chat"]);
  } finally { GeminiAdapter.prototype.run = originalRun; }
});

test("MCP and direct cloud images reject sensitive content, and execution requires opt-in", async () => {
  try {
    const generator = new ImageGenerator();
    await assert.rejects(generator.generate("my passport details"), /Sensitive content/);
    const image = await invoke("generate_image", { prompt: "Draw my passport details" });
    assert.match(JSON.stringify(image), /Sensitive content cannot/);
    process.env.OPENAI_IMAGE_ENABLED = "false";
    assert.equal(generator.available, false);
    await assert.rejects(generator.generate("Draw a tree"), /Image generation is disabled/);
    assert.equal(fetchCalls, 0);
  } finally { process.env.OPENAI_IMAGE_ENABLED = "true"; }
});

test("MCP provider, image and council errors redact raw provider diagnostics", async () => {
  const originalChat = MultiAIHub.prototype.chat;
  fetchFixture = async (input) => {
    const error = String(input).startsWith("https://api.openai.com/") ? { message: sentinel } : sentinel;
    return new Response(JSON.stringify({ error }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  };
  MultiAIHub.prototype.chat = async function() { throw new Error(sentinel); };
  try {
    for (const [name, args] of [
      ["ask_openai", { prompt: "Explain sorting" }],
      ["ask_qwen", { prompt: "Explain sorting" }],
      ["generate_image", { prompt: "Draw a tree" }],
      ["council_review", { prompt: "Compare sorting algorithms", mode: "quick", maxSeats: 1 }],
    ] as const) {
      const result = JSON.stringify(await invoke(name, args));
      assert.ok(!result.includes(sentinel), name);
      assert.match(result, /Provider request failed/, name);
    }
    assert.deepEqual(fetchRequests.map(([input]) => String(input)), [
      "http://127.0.0.1:11434/api/chat",
      "https://api.openai.com/v1/images/generations",
      "http://127.0.0.1:11434/api/chat",
    ], "the MCP image singleton and local seats must use the intercepted transport");
    assert.ok(fetchRequests.every(([, init]) => init?.method === "POST"));
    assert.equal(JSON.parse(String(fetchRequests[1]?.[1]?.body)).prompt, "Draw a tree");
  } finally { MultiAIHub.prototype.chat = originalChat; }
});
