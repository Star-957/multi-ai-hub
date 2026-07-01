import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Claude MCP bridge exposes the expected AI tools", async () => {
  const root = path.resolve(".");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/mcp-server.ts")],
    cwd: root,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(root, ".env"),
      MULTI_AI_ROOT: root,
    } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "multi-ai-hub-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    // Always-on core = the 3 base ask_* tools, the local seats (Ollama configured by default),
    // council_review, and multi_ai_status. Optional extras only appear when their key is present:
    // generate_image (OpenAI image), and the cloud seats ask_groq / ask_cerebras / ask_mistral / ask_openrouter / ask_glm / ask_nvidia. The repo
    // .env ships without those keys, so they are normally absent. Assert core present, nothing else.
    const names = listed.tools.map((tool) => tool.name).sort();
    const core = [
      "ask_deepseek",
      "ask_gemini",
      "ask_llama_fast",
      "ask_ollama",
      "ask_openai",
      "ask_qwen",
      "council_review",
      "multi_ai_status",
    ];
    const allowed = new Set([...core, "generate_image", "ask_groq", "ask_cerebras", "ask_mistral", "ask_openrouter", "ask_glm", "ask_nvidia"]);
    for (const t of core) assert.ok(names.includes(t), `missing core tool: ${t}`);
    for (const n of names) assert.ok(allowed.has(n), `unexpected tool advertised: ${n}`);

    const status = await client.callTool({ name: "multi_ai_status", arguments: {} });
    assert.equal(status.isError, undefined);
    assert.ok(Array.isArray(status.content));
  } finally {
    await client.close();
  }
});
