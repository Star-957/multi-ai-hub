import assert from "node:assert/strict";
import test from "node:test";
import { MultiAIHub } from "../src/hub.js";

test("status exposes optional council seat metadata without secrets", () => {
  const status = new MultiAIHub().status();
  const nvidia = status.councilSeats.nvidia;
  const llamaFast = status.councilSeats.llama_fast;

  assert.ok(nvidia);
  assert.ok(llamaFast);
  assert.equal(typeof nvidia.configured, "boolean");
  assert.equal(nvidia.model, "meta/llama-3.3-70b-instruct");
  assert.equal(nvidia.locality, "cloud");
  assert.equal(llamaFast.locality, "local");

  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes("GEMINI_API_KEY"));
  assert.ok(!serialized.includes("NVIDIA_API_KEY"));
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(serialized));
  assert.ok(!/nvapi-[0-9A-Za-z_-]{20,}/.test(serialized));
});
