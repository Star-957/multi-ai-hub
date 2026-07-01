import assert from "node:assert/strict";
import test from "node:test";
import { isSensitive } from "../src/sensitivity.js";
import { resolveSensitivity } from "../src/council.js";

test("isSensitive catches estate/legal/finance/identity markers (Trad + Simp + English + HKID)", () => {
  for (const s of [
    "幫我搞親屬嘅遺產 probate",
    "親屬 intestate 嘅 代位繼承 限期",
    "遗产同埋亲属嘅继承", // simplified
    "my HKID is A123456(7)",
    "the inheritance estate is worth millions",
    "強積金 MPF 同 銀行帳戶 結餘",
  ]) {
    assert.equal(isSensitive(s), true, `should flag: ${s}`);
  }
});

test("isSensitive does NOT flag benign coding/everyday prompts", () => {
  for (const s of [
    "refactor the login component and add a dark mode toggle",
    "幫我諗個 IG Reel 嘅 hook",
    "compare these two sorting algorithms",
    "",
  ]) {
    assert.equal(isSensitive(s), false, `should NOT flag: ${s}`);
  }
});

test("resolveSensitivity FAILS CLOSED: sensitive prompt forces private even if caller said normal", () => {
  const r = resolveSensitivity("plan the family estate litigation", "normal");
  assert.equal(r.sensitivity, "private");
  assert.equal(r.source, "auto-escalated");
});

test("resolveSensitivity honours an explicit caller flag on a benign prompt", () => {
  assert.deepEqual(resolveSensitivity("add a button", "private"), { sensitivity: "private", source: "caller" });
  assert.deepEqual(resolveSensitivity("add a button", "normal"), { sensitivity: "normal", source: "caller" });
});

test("resolveSensitivity defaults to normal when caller says nothing and prompt is benign", () => {
  assert.deepEqual(resolveSensitivity("add a button"), { sensitivity: "normal", source: "default" });
});

test("num() accepts percentage-style confidence", async () => {
  const { parseSeatOutput } = await import("../src/council.js");
  const r = parseSeatOutput("qwen", JSON.stringify({ verdict: "PASS", new_information: "a genuinely new point here", confidence: 80 }));
  assert.equal(r.confidence, 0.8);
});

test("num() treats a near-1 confidence (1.5) as high, not as 1.5%", async () => {
  const { parseSeatOutput } = await import("../src/council.js");
  const r = parseSeatOutput("qwen", JSON.stringify({ verdict: "PASS", new_information: "another genuinely new point", confidence: 1.5 }));
  // Old code did 1.5/100 = 0.015; the guard now clamps 1<n<=1.5 to 1.
  assert.equal(r.confidence, 1);
});
