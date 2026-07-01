import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, parseSeatOutput, runSeatPlain, type SeatReview } from "../src/council.js";
import { MultiAIHub } from "../src/hub.js";

test("malformed seat output fails closed (parsed=false, no throw)", () => {
  const r = parseSeatOutput("qwen", "I think this plan is fine, ship it.");
  assert.equal(r.parsed, false);
  assert.equal(r.verdict, "UNKNOWN");
  assert.equal(r.novelty, "low");
});

test("valid JSON seat output is parsed with normalized fields and high novelty", () => {
  const raw = JSON.stringify({
    verdict: "revise",
    top_objection: "no demand validation",
    new_information: "there is no waitlist or proof anyone will pay before launch",
    disagreement_with_previous: "no material disagreement",
    hidden_cost: "month-2 churn",
    risk: "high",
    confidence: 0.8,
  });
  const r = parseSeatOutput("gemini", raw);
  assert.equal(r.parsed, true);
  assert.equal(r.verdict, "REVISE");
  assert.equal(r.risk, "HIGH");
  assert.equal(r.novelty, "high");
  assert.equal(r.confidence, 0.8);
});

test("fenced ```json``` output is still parsed", () => {
  const r = parseSeatOutput(
    "qwen",
    '```json\n{"verdict":"PASS","new_information":"a genuinely new and useful point here"}\n```',
  );
  assert.equal(r.parsed, true);
  assert.equal(r.verdict, "PASS");
});

test("a reviewer with empty new_information is low novelty (does not count as independent)", () => {
  const r = parseSeatOutput("qwen", JSON.stringify({ verdict: "PASS", new_information: "" }));
  assert.equal(r.novelty, "low");
});

test("aggregate fails closed when there are no valid reviews", () => {
  const reviews: SeatReview[] = [
    {
      seat: "qwen",
      title: "Qwen",
      ok: false,
      parsed: false,
      verdict: "UNKNOWN",
      top_objection: "",
      new_information: "",
      disagreement_with_previous: "",
      hidden_cost: "",
      risk: "UNKNOWN",
      confidence: 0,
      novelty: "low",
      error: "boom",
    },
  ];
  const s = aggregate(reviews);
  assert.equal(s.majority_verdict, "UNKNOWN");
  assert.equal(s.novelty_score, 0);
  assert.equal(s.unknowns.length, 1);
});

test("aggregate computes majority verdict and flags source checks on HIGH risk", () => {
  const base = {
    ok: true,
    parsed: true,
    top_objection: "",
    disagreement_with_previous: "",
    hidden_cost: "",
    confidence: 0.5,
    novelty: "high" as const,
  };
  const reviews: SeatReview[] = [
    { seat: "qwen", title: "Qwen", verdict: "REVISE", new_information: "alpha unique point", risk: "HIGH", ...base },
    { seat: "gemini", title: "Gemini", verdict: "REVISE", new_information: "beta different point", risk: "LOW", ...base },
    { seat: "groq", title: "Groq", verdict: "PASS", new_information: "gamma another point", risk: "LOW", ...base },
  ];
  const s = aggregate(reviews);
  assert.equal(s.majority_verdict, "REVISE");
  assert.equal(s.source_checks_required, true);
  assert.ok(s.novelty_score > 0);
});

test("extractJson survives prose with stray braces around the real object", () => {
  const raw =
    'Consider the set {a, b}. Here is my review: {"verdict":"REJECT","new_information":"the budget math does not close"} — also note {}.';
  const r = parseSeatOutput("gemini", raw);
  assert.equal(r.parsed, true);
  assert.equal(r.verdict, "REJECT");
  assert.equal(r.novelty, "high");
});

test("DeepSeek manual seat can run locally when explicitly requested", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: "local deepseek ok" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const hub = new MultiAIHub();
    const text = await runSeatPlain(hub, "deepseek", "review this");

    assert.equal(text, "local deepseek ok");
    assert.equal(body?.model, "deepseek-r1:70b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
