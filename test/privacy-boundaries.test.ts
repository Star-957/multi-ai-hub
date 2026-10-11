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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  try {
    const hub = new MultiAIHub();
    const council = await runCouncil(hub, { prompt: "Compare sorting algorithms", mode: "quick", maxSeats: 1 });
    assert.equal(council.reviews[0]?.seat, "gemini");
    assert.equal(council.reviews[0]?.ok, true);
    assert.equal(council.reviews.length, 1);
    assert.equal(calls, 1);
    await assert.rejects(hub.chat("gemini", "my passport details"), /Sensitive content/);
    const privateCouncil = await runCouncil(hub, { prompt: "my passport details", mode: "quick", maxSeats: 1 });
    assert.equal(privateCouncil.cloud_used, false);
    assert.equal(calls, 1);
  } finally { GeminiAdapter.prototype.run = originalRun; globalThis.fetch = originalFetch; }
});

test("MCP and direct cloud images reject sensitive content, and execution requires opt-in", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  try {
    const generator = new ImageGenerator();
    await assert.rejects(generator.generate("my passport details"), /Sensitive content/);
    const image = await invoke("generate_image", { prompt: "Draw my passport details" });
    assert.match(JSON.stringify(image), /Sensitive content cannot/);
    process.env.OPENAI_IMAGE_ENABLED = "false";
    assert.equal(generator.available, false);
    await assert.rejects(generator.generate("Draw a tree"), /Image generation is disabled/);
    assert.equal(calls, 0);
  } finally { process.env.OPENAI_IMAGE_ENABLED = "true"; globalThis.fetch = originalFetch; }
});

test("MCP provider, image and council errors redact raw provider diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const originalChat = MultiAIHub.prototype.chat;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: sentinel } }), {
    status: 400, headers: { "content-type": "application/json" },
  });
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
  } finally { MultiAIHub.prototype.chat = originalChat; globalThis.fetch = originalFetch; }
});
