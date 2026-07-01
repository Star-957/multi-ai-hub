import { config } from "../config.js";
import { systemPrompt } from "../system-prompt.js";
import type { AgentResult, ProviderAdapter, RunContext } from "../types.js";

type OllamaChatResponse = {
  message?: {
    content?: string;
    thinking?: string;
  };
  error?: string;
};

export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama" as const;

  // Per-instance model + output-budget override lets the hub run distinct local seats (Qwen /
  // Llama-fast) off the same adapter, each within the council's own per-seat token budget. Both
  // default to the global config so existing `new OllamaAdapter()` is unchanged.
  constructor(
    private readonly model: string = config.ollama.model,
    private readonly maxTokens: number = config.maxOutputTokens,
  ) {}

  async run(prompt: string, context: RunContext): Promise<AgentResult> {
    try {
      return await this.runChat(prompt, context, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isThinkingUnsupported(message)) throw error;
      return this.runChat(prompt, context, false);
    }
  }

  private async runChat(prompt: string, context: RunContext, thinking: boolean): Promise<AgentResult> {
    const endpoint = config.ollama.endpoint.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      model: this.model,
      stream: true, // stream so we can cut by PROGRESS, not by a blind wall-clock
      messages: [
        { role: "system", content: systemPrompt(this.name, context) },
        { role: "user", content: prompt },
      ],
      options: {
        temperature: 0.2,
        num_predict: this.maxTokens,
      },
    };
    if (thinking) body.think = true;

    // Value-based cutoff: let a local seat keep running while it is producing output, and
    // only cut it when it stalls (no new tokens for IDLE_MS).
    // The hard cap is a runaway backstop only, intentionally generous so a slow-but-productive seat
    // is never killed mid-stream.
    const IDLE_MS = 120_000; // after first token: no new output for 2 min -> stalled -> cut
    const FIRST_TOKEN_MS = 300_000; // before first token: allow a cold 30B/70B model load up to 5 min
    const HARD_CAP_MS = 20 * 60_000; // absolute backstop
    const controller = new AbortController();
    let abortReason = "";
    let lastProgress = Date.now();
    let gotFirstChunk = false; // a cold model load streams nothing until weights are ready
    const hardTimer = setTimeout(() => {
      abortReason = "hard cap reached";
      controller.abort();
    }, HARD_CAP_MS);
    const idleTimer = setInterval(() => {
      // Give the FIRST token a longer grace (cold load), then a tight idle window once streaming.
      const limit = gotFirstChunk ? IDLE_MS : FIRST_TOKEN_MS;
      if (Date.now() - lastProgress > limit) {
        abortReason = gotFirstChunk ? "no progress (stalled)" : "no first token (cold-load timed out)";
        controller.abort();
      }
    }, 5_000);

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        let msg = `Ollama request failed (${response.status})`;
        try {
          const j = JSON.parse(errText) as OllamaChatResponse;
          if (j.error) msg = j.error;
        } catch {
          /* keep generic message */
        }
        throw new Error(msg);
      }

      let content = "";
      let sawError = "";
      const ingest = (line: string) => {
        const s = line.trim();
        if (!s) return;
        let obj: OllamaChatResponse;
        try {
          obj = JSON.parse(s) as OllamaChatResponse;
        } catch {
          return; // ignore a partial/non-JSON line
        }
        if (obj.error) sawError = obj.error;
        // A reasoning model (think:true — incl. the default qwen3:30b) streams `thinking` deltas with
        // EMPTY content during its reasoning phase. Count BOTH thinking and content as progress
        // (audit 2026-06-29 OLLAMA-1) so the idle timer never cuts a model that is actively reasoning.
        const c = obj.message?.content;
        const th = obj.message?.thinking;
        if (c || th) {
          gotFirstChunk = true;
          lastProgress = Date.now(); // making progress -> reset the idle clock
        }
        if (c) content += c;
      };

      if (response.body) {
        // Streaming NDJSON: one JSON object per line. Accumulate content deltas; idle timer above
        // cuts the seat if the stream stops producing. (Also handles a single-object non-stream body.)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            ingest(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        }
        ingest(buf);
      } else {
        // No readable stream available: parse the whole body once.
        const text = await response.text();
        try {
          const data = JSON.parse(text) as OllamaChatResponse;
          if (data.error) sawError = data.error;
          content = data.message?.content ?? "";
        } catch {
          throw new Error(`Ollama returned invalid JSON (${response.status})`);
        }
      }
      if (sawError) throw new Error(sawError);

      return {
        provider: this.name,
        text: content.trim() || "Ollama returned no final answer.",
        artifacts: [],
        trace: context.trace,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Ollama seat cut: ${abortReason || "aborted"}`);
      }
      throw error;
    } finally {
      clearTimeout(hardTimer);
      clearInterval(idleTimer);
    }
  }
}

function isThinkingUnsupported(message: string): boolean {
  return /does not support thinking|thinking.*not supported|unsupported.*think/i.test(message);
}
