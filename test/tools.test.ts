import assert from "node:assert/strict";
import test from "node:test";
import { readPrompt, toolDefinitions } from "../src/tools.js";
import type { RunContext } from "../src/types.js";

function context(depth = 0, maxDepth = 3): RunContext {
  return { depth, maxDepth, path: ["claude"], trace: [] };
}

test("Claude receives cross-provider and image tools", () => {
  const tools = toolDefinitions(
    "claude",
    { openai: true, claude: true, gemini: true, ollama: true },
    true,
    context(),
  );
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["ask_openai", "ask_gemini", "ask_ollama", "generate_image"],
  );
});

test("delegation tools disappear at maximum depth but image remains available", () => {
  const tools = toolDefinitions(
    "openai",
    { openai: true, claude: true, gemini: true, ollama: true },
    true,
    context(3, 3),
  );
  assert.deepEqual(tools.map((tool) => tool.name), ["generate_image"]);
});

test("unconfigured providers are never exposed", () => {
  const tools = toolDefinitions(
    "openai",
    { openai: true, claude: true, gemini: false, ollama: false },
    false,
    context(),
  );
  assert.deepEqual(tools.map((tool) => tool.name), ["ask_claude"]);
});

test("tool prompts are validated and trimmed", () => {
  assert.equal(readPrompt({ name: "ask_openai", input: { prompt: "  hello  " } }), "hello");
  assert.throws(() => readPrompt({ name: "ask_openai", input: { prompt: "" } }), /non-empty/);
});
