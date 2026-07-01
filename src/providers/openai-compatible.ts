import { config } from "../config.js";

// Minimal client for any OpenAI-compatible /chat/completions endpoint (Groq, Cerebras, Z.ai GLM,
// OpenRouter, ...). Used by council/seat cloud seats. Plain function, not a hub Provider — these
// seats are layered on top of the 4 base providers and never participate in in-hub delegation.
export type OpenAICompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs?: number;
};

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
};

export async function runOpenAICompatible(opts: OpenAICompatibleOptions): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      temperature: 0.2,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? config.requestTimeoutMs),
  });

  const text = await response.text();
  let data: ChatCompletion;
  try {
    data = JSON.parse(text) as ChatCompletion;
  } catch {
    throw new Error(`OpenAI-compatible endpoint returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(message || `Request failed (${response.status})`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI-compatible endpoint returned no content");
  return content;
}
