import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { config, configuredProviders } from "./config.js";
import { MultiAIHub } from "./hub.js";
import { ImageGenerator } from "./image-generator.js";
import { runCouncil, runSeatPlain } from "./council.js";
import { SEATS, seatConfigured, type SeatId } from "./seats.js";
import { isSensitive } from "./sensitivity.js";
import type { AgentResult, Artifact } from "./types.js";

const hub = new MultiAIHub();
const imageGenerator = new ImageGenerator();
const server = new McpServer({ name: "multi-ai-hub", version: "1.2.0" });
const promptSchema = {
  prompt: z.string().min(1).max(30_000).describe("A complete task with all context the other AI needs."),
};

server.registerTool(
  "ask_openai",
  {
    title: "Ask OpenAI",
    description:
      "Delegate a bounded task to OpenAI GPT-5.5. Best for tool-heavy reasoning, coding, synthesis, or an independent second opinion. " +
      "Ask it to name what you might be missing — hidden risks, counterexamples, or a simpler route — not to restate your view. " +
      "Do not use when Claude can answer directly without benefit.",
    inputSchema: promptSchema,
  },
  async ({ prompt }) => runProvider("openai", prompt),
);

server.registerTool(
  "ask_gemini",
  {
    title: "Ask Gemini",
    description:
      "Delegate a bounded task to Gemini (Flash). Best for a fast alternative analysis, critique, or comparison. " +
      "Ask it to attack your assumptions and find a simpler alternative or a hidden risk — complementary disagreement, not a duplicate answer.",
    inputSchema: promptSchema,
  },
  async ({ prompt }) => runProvider("gemini", prompt),
);

server.registerTool(
  "ask_ollama",
  {
    title: "Ask local Qwen",
    description:
      "Delegate a bounded private task to the free local Qwen3 30B model through Ollama. Best for a no-API-cost second opinion, private draft critique, multilingual comparison, or offline fallback. " +
      "Ask it to challenge your assumptions and surface new information or a hidden cost. Treat its answer as an independent opinion, not proof of truth.",
    inputSchema: promptSchema,
  },
  async ({ prompt }) => runProvider("ollama", prompt),
);

// --- Council v2 seats (layered on top of the 4 base providers; existing routing unchanged) --------
// One helper for every single-seat ask_<seat> tool. DeepSeek is exposed only as an explicit local
  // manual tool and stays out of every default council path.
async function seatTool(seat: SeatId, prompt: string) {
  // Fail-closed privacy: a cloud seat must refuse sensitive content even via the single-seat tool
  // (the council's auto-escalation only covers council_review, not a direct ask_groq/ask_glm call).
  if (SEATS[seat].locality === "cloud" && isSensitive(prompt)) {
    return toolError(
      `Blocked: this prompt looks sensitive (estate/legal/finance/identity) and "${seat}" is a CLOUD seat. ` +
        "Use a local seat instead — ask_qwen or ask_llama_fast (on-machine, nothing leaves the workstation).",
    );
  }
  try {
    const text = await runSeatPlain(hub, seat, prompt);
    return { content: [{ type: "text" as const, text }], structuredContent: { seat, text } };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

// Local seats: always available when Ollama is configured.
if (configuredProviders().ollama) {
  server.registerTool(
    "ask_qwen",
    {
      title: "Ask local Qwen (seat)",
      description:
        "Delegate a bounded private task to the local Qwen 30B seat through Ollama (no API cost, offline) — same local Qwen as ask_ollama, exposed as a named council seat. " +
        "Ask it to challenge your assumptions and surface new information or a hidden cost. Independent opinion, not proof.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("qwen", prompt),
  );
  server.registerTool(
    "ask_llama_fast",
    {
      title: "Ask fast local seat (fast sanity)",
      description:
        "Delegate a quick sanity check to the small fast local seat (Qwen3 8B) through Ollama. " +
        "Best for catching obvious contradictions or the single biggest hole. Cheap, local, not authoritative.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("llama_fast", prompt),
  );
  server.registerTool(
    "ask_deepseek",
    {
      title: "Ask local DeepSeek (manual heavy)",
      description:
        "Explicitly run the local DeepSeek seat through Ollama. Use only when the user asks for a heavier local reasoning pass and accepts the RAM/VRAM cost. " +
        "Local-only: it does not send data to DeepSeek cloud. Manual-only: never part of default council presets.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("deepseek", prompt),
  );
}

// Cloud seats: dormant until their API key is in .env, then they auto-register.
if (seatConfigured("groq")) {
  server.registerTool(
    "ask_groq",
    {
      title: "Ask Groq (fast cloud)",
      description:
        "Delegate a high-speed sanity check or independent second opinion to Groq. Ask for a hidden risk or a simpler alternative, not a duplicate. " +
        "Cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("groq", prompt),
  );
}
if (seatConfigured("cerebras")) {
  server.registerTool(
    "ask_cerebras",
    {
      title: "Ask Cerebras (fast cloud)",
      description:
        "Delegate a high-speed code/logic sanity check or model comparison to Cerebras. Ask for a counterexample or a simpler route. " +
        "Cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("cerebras", prompt),
  );
}
if (seatConfigured("mistral")) {
  server.registerTool(
    "ask_mistral",
    {
      title: "Ask Mistral (free-mode cloud)",
      description:
        "Delegate a bounded writing/coding sanity check to Mistral. Good as a free-mode/open-model-family extra critic when configured. " +
        "Ask for a different framing, hidden risk, or simpler route. Cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("mistral", prompt),
  );
}
if (seatConfigured("openrouter")) {
  server.registerTool(
    "ask_openrouter",
    {
      title: "Ask OpenRouter free model (cloud)",
      description:
        "Delegate an occasional extra critique to OpenRouter's configured free model. Default is a non-DeepSeek free Llama model; override OPENROUTER_MODEL if needed. " +
        "Rate-limited free cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("openrouter", prompt),
  );
}
if (seatConfigured("glm")) {
  server.registerTool(
    "ask_glm",
    {
      title: "Ask GLM-5.2 (cloud architect)",
      description:
        "Delegate long-horizon coding/architecture review to GLM-5.2 (paid cloud). Ask for structural risks and rollback gaps. Opt-in: this seat costs money. " +
        "Cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("glm", prompt),
  );
}
if (seatConfigured("nvidia")) {
  server.registerTool(
    "ask_nvidia",
    {
      title: "Ask NVIDIA NIM (free cloud)",
      description:
        "Delegate a bounded sanity check or independent second opinion to a free NVIDIA-hosted open model (Llama/Mistral/Qwen on NVIDIA's GPUs). " +
        "Ask for a hidden risk or simpler route, not a duplicate. Rate-limited free cloud seat — do NOT use for private/sensitive (estate/identity/finance) content.",
      inputSchema: promptSchema,
    },
    async ({ prompt }) => seatTool("nvidia", prompt),
  );
}

server.registerTool(
  "council_review",
  {
    title: "Run a multi-AI council review",
    description:
      "Run a structured, anti-echo council: several role-typed seats each return a verdict + what is NEW + their disagreement + hidden cost, then a mechanical synthesis (majority / minority / unknowns / novelty / source-checks-required). " +
      "mode: quick (everyday), private (LOCAL-ONLY for sensitive drafts — no cloud seats), coding (hub/architecture). sensitivity=private forces local-only regardless of mode. Seats run sequentially within a budget; DeepSeek is never auto-included. YOU (the commander) write the final answer from the result — it is not proof.",
    inputSchema: {
      prompt: z.string().min(1).max(30_000).describe("The proposal, plan, or question to put to the council."),
      mode: z.enum(["quick", "private", "coding"]).optional().describe("Seat preset. Default quick."),
      sensitivity: z
        .enum(["normal", "private"])
        .optional()
        .describe("private excludes ALL cloud seats (estate/identity/finance/sensitive). Default normal."),
      maxSeats: z.number().int().min(1).max(6).optional().describe("Hard cap on seats for this run."),
    },
  },
  async ({ prompt, mode, sensitivity, maxSeats }) => {
    try {
      const result = await runCouncil(hub, { prompt, mode, sensitivity, maxSeats });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
    } catch (error) {
      return toolError(errorMessage(error));
    }
  },
);

// Only advertise generate_image when OpenAI image generation is actually usable
// (API key present AND OPENAI_IMAGE_ENABLED=true). Avoids the commander wasting a tool
// round on an image tool that cannot run. Mirrors the sub-agent toolDefinitions() gate.
if (configuredProviders().imageGeneration) {
  server.registerTool(
    "generate_image",
    {
      title: "Generate image with OpenAI",
      description:
        "Generate and save a new image with OpenAI gpt-image-2. Use only when the user requests or clearly needs a visual asset.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .max(30_000)
          .describe("Detailed visual brief including composition, style, lighting, and exact text if any."),
      },
    },
    async ({ prompt }) => {
      if (!imageGenerator.available) return toolError("OPENAI_API_KEY is not configured in .env");
      try {
        const artifact = await imageGenerator.generate(prompt);
        return {
          content: await artifactContent(artifact),
          structuredContent: artifact,
        };
      } catch (error) {
        return toolError(errorMessage(error));
      }
    },
  );
}

server.registerTool(
  "multi_ai_status",
  {
    title: "Check multi-AI connections",
    description:
      "Check which AI providers and image tools are configured before delegating work. " +
      "Configuration does not guarantee that a provider currently has quota or billing credit.",
    inputSchema: {},
  },
  async () => {
    const status = hub.status();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status,
    };
  },
);

async function runProvider(provider: "openai" | "gemini" | "ollama", prompt: string) {
  const status = hub.status();
  if (!status[provider]) return toolError(`${provider} is not configured in .env`);
  // Fail-closed privacy: never send estate/legal/finance/identity content to a cloud provider.
  if (provider !== "ollama" && isSensitive(prompt)) {
    return toolError(
      `Blocked: this prompt looks sensitive (estate/legal/finance/identity) and "${provider}" is a CLOUD provider. ` +
        "Use ask_ollama (local Qwen, on-machine) instead.",
    );
  }
  try {
    // Claude is already the controller. Blocking it here avoids a nested Claude → AI → Claude loop.
    const result = await hub.chat(provider, prompt, { blockedProviders: ["claude"] });
    return {
      content: await resultContent(result),
      structuredContent: {
        provider: result.provider,
        text: result.text,
        artifacts: result.artifacts,
        trace: result.trace,
      },
    };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

async function resultContent(result: AgentResult) {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: result.text }];
  for (const artifact of result.artifacts) content.push(...(await artifactContent(artifact)));
  return content;
}

async function artifactContent(artifact: Artifact) {
  const filename = path.basename(artifact.url);
  const absolutePath = path.join(config.projectRoot, "data/generated", filename);
  const data = await readFile(absolutePath, "base64");
  return [
    { type: "text" as const, text: `Image saved to ${absolutePath}` },
    { type: "image" as const, data, mimeType: "image/png" },
  ];
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Multi-AI MCP server connected over stdio");
