import assert from "node:assert/strict";
import test from "node:test";
import { systemPrompt } from "../src/system-prompt.js";
import type { RunContext } from "../src/types.js";

function context(depth = 0, maxDepth = 3): RunContext {
  return { depth, maxDepth, path: ["claude"], trace: [] };
}

// Locks the depth-gated co-pilot behaviour: the top-level agent gets the full Proactive
// Co-pilot Contract; a delegated sub-agent (depth > 0) gets only the lean, focused line.
// Guards against an accidental future inversion of the `context.depth === 0` check.
test("top-level agent (depth 0) gets the proactive co-pilot contract", () => {
  const prompt = systemPrompt("claude", context(0));
  assert.ok(prompt.includes("PROACTIVE CO-PILOT CONTRACT"), "depth 0 must include the contract");
  assert.ok(!prompt.includes("bounded delegated subtask"), "depth 0 must not get the lean delegate line");
});

test("delegated sub-agent (depth > 0) gets the lean focused line, not the full contract", () => {
  const prompt = systemPrompt("gemini", context(1));
  assert.ok(!prompt.includes("PROACTIVE CO-PILOT CONTRACT"), "delegates must not get the heavy contract");
  assert.ok(prompt.includes("bounded delegated subtask"), "delegates must get the lean focused line");
});
