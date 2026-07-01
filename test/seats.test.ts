import assert from "node:assert/strict";
import test from "node:test";
import { SEATS, seatConfigured, selectSeats } from "../src/seats.js";

test("private sensitivity excludes ALL cloud seats", () => {
  const { seats } = selectSeats("quick", "private");
  for (const id of seats) assert.equal(SEATS[id].locality, "local", `${id} leaked into a private council`);
});

test("DeepSeek is never in a default council preset", () => {
  for (const mode of ["quick", "private", "coding"] as const) {
    const { seats } = selectSeats(mode, "normal");
    assert.ok(!seats.includes("deepseek"), `deepseek must not appear in ${mode}`);
  }
});

test("maxSeats caps the roster", () => {
  const { seats } = selectSeats("quick", "normal", 1);
  assert.ok(seats.length <= 1, `expected <=1 seat, got ${seats.length}`);
});

test("quick council prefers the lightweight local seat over Qwen 30B", () => {
  const { seats } = selectSeats("quick", "normal");
  assert.ok(seats.includes("llama_fast"), "quick council should include the fast local sanity seat");
  assert.ok(!seats.includes("qwen"), "quick council should not load Qwen 30B by default");
});

test("quick council has Mistral as an optional free-mode cloud critic", () => {
  const { seats, dropped } = selectSeats("quick", "normal", 10);
  assert.ok(
    seats.includes("mistral") || dropped.some((entry) => entry.id === "mistral" && /not configured/.test(entry.reason)),
    "Mistral should be in the quick preset, either configured or explicitly dropped as unconfigured",
  );
});

test("quick council has NVIDIA NIM as an optional free-model cloud critic", () => {
  const { seats, dropped } = selectSeats("quick", "normal", 10);
  assert.ok(
    seats.includes("nvidia") || dropped.some((entry) => entry.id === "nvidia" && /not configured/.test(entry.reason)),
    "NVIDIA NIM should be in the quick preset, either configured or explicitly dropped as unconfigured",
  );
});

test("cloud seat configuration is boolean and env-driven", () => {
  assert.equal(typeof seatConfigured("groq"), "boolean");
  assert.equal(typeof seatConfigured("cerebras"), "boolean");
  assert.equal(typeof seatConfigured("mistral"), "boolean");
  assert.equal(typeof seatConfigured("openrouter"), "boolean");
  assert.equal(typeof seatConfigured("glm"), "boolean");
  assert.equal(typeof seatConfigured("nvidia"), "boolean");
});

test("local Qwen/Llama seats are configured by default (Ollama endpoint present)", () => {
  assert.equal(seatConfigured("qwen"), true);
  assert.equal(seatConfigured("llama_fast"), true);
});
