import assert from "node:assert/strict";
import test from "node:test";
import { OllamaAdapter } from "../src/providers/ollama.js";

const context = { depth: 1, maxDepth: 3, path: [], trace: [] };

test("OllamaAdapter retries without the think field when a model rejects thinking", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);

    if (bodies.length === 1) {
      return new Response(JSON.stringify({ error: '"llama3.2:latest" does not support thinking' }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: { content: '{"ok":true,"seat":"llama_fast"}' } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const adapter = new OllamaAdapter("llama3.2:latest", 80);
    const result = await adapter.run("Return compact JSON.", context);

    assert.equal(result.text, '{"ok":true,"seat":"llama_fast"}');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!.think, true);
    assert.equal("think" in bodies[1]!, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
