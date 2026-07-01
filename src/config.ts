import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const projectRoot = path.resolve(process.env.MULTI_AI_ROOT ?? process.cwd());

export const config = {
  projectRoot,
  host: process.env.HOST ?? "127.0.0.1",
  port: numberFromEnv("PORT", 8787),
  maxDelegationDepth: numberFromEnv("MAX_DELEGATION_DEPTH", 3),
  maxToolRounds: numberFromEnv("MAX_TOOL_ROUNDS", 6),
  maxOutputTokens: numberFromEnv("MAX_OUTPUT_TOKENS", 4096),
  requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 120_000),
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.5",
    imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    transport:
      process.env.CLAUDE_TRANSPORT === "api" || process.env.CLAUDE_TRANSPORT === "cli"
        ? process.env.CLAUDE_TRANSPORT
        : process.env.ANTHROPIC_API_KEY
          ? "api"
          : "cli",
    effort: process.env.CLAUDE_EFFORT ?? "max",
    // Resolve to whichever CLI binary actually exists (audit 2026-06-29). The npm package ships its
    // mac binary literally named `claude.exe` (a native Mach-O arm64 — the `.exe` is just a filename),
    // so the earlier `process.platform==="win32"?...:"claude"` switch resolved darwin to a NONEXISTENT
    // path and silently dropped the Claude CLI provider. Prefer an extensionless `claude` if present,
    // else `claude.exe`; CLAUDE_CLI_PATH still overrides.
    cliPath:
      process.env.CLAUDE_CLI_PATH ??
      [
        path.join(projectRoot, "node_modules/@anthropic-ai/claude-code/bin/claude"),
        path.join(projectRoot, "node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
      ].find((p) => existsSync(p)) ??
      path.join(projectRoot, "node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  },
  ollama: {
    endpoint: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL ?? "qwen3:30b", // ask_ollama / ask_qwen seat
    // ask_llama_fast seat. Default is qwen3:8b; override with OLLAMA_FAST_MODEL if you prefer
    // a smaller model such as llama3.2.
    fastModel: process.env.OLLAMA_FAST_MODEL ?? "qwen3:8b",
    // Manual-only heavy local seat. NEVER in a default council preset; explicit local use is OK.
    deepseekModel: process.env.OLLAMA_DEEPSEEK_MODEL ?? "deepseek-r1:70b",
  },
  // OpenAI-compatible cloud council seats. Dormant until the matching API key is in .env.
  // Model ids are configurable defaults — verify against each provider's docs before relying on them.
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  cerebras: {
    apiKey: process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
    baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY,
    model: process.env.MISTRAL_MODEL ?? "mistral-small-latest",
    baseUrl: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    // Non-DeepSeek default on purpose. Users may opt into any OpenRouter :free model via env,
    // but the shipped default must not silently route private/local-intended work through a
    // third-party cloud model family he did not ask for.
    model: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  },
  glm: {
    apiKey: process.env.GLM_API_KEY ?? process.env.ZAI_API_KEY,
    model: process.env.GLM_MODEL ?? "glm-5.2",
    baseUrl: process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4",
  },
  // NVIDIA NIM — free OpenAI-compatible cloud seat (build.nvidia.com, nvapi- key, ~40 req/min).
  // Dormant until NVIDIA_API_KEY is in .env. Cloud => never receives sensitive/private prompts.
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL ?? "meta/llama-3.3-70b-instruct",
    baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  },
  // Hard budget guards for a council run (occasional meetings, never always-on swarms).
  council: {
    maxSeats: numberFromEnv("COUNCIL_MAX_SEATS", 4),
    maxInputChars: numberFromEnv("COUNCIL_MAX_INPUT_CHARS", 12_000),
    maxOutputTokens: numberFromEnv("COUNCIL_MAX_OUTPUT_TOKENS", 1500),
    // Whole-council wall-clock ceiling = a backstop for starting new seats, not the primary
    // local-model control. The OllamaAdapter idle timeout cuts stalled local seats.
    maxWallClockMs: numberFromEnv("COUNCIL_MAX_WALLCLOCK_MS", 600_000),
  },
} as const;

const claudeCliInstalled = existsSync(config.anthropic.cliPath);
const claudeCliLoggedIn = claudeCliInstalled ? detectClaudeCliLogin() : false;

export const claudeCliStatus = {
  installed: claudeCliInstalled,
  loggedIn: claudeCliLoggedIn,
};

export function configuredProviders() {
  return {
    openai: Boolean(config.openai.apiKey),
    claude:
      config.anthropic.transport === "api"
        ? Boolean(config.anthropic.apiKey)
        : claudeCliInstalled && claudeCliLoggedIn,
    gemini: Boolean(config.gemini.apiKey),
    ollama: Boolean(config.ollama.endpoint && config.ollama.model),
    imageGeneration: Boolean(config.openai.apiKey) && process.env.OPENAI_IMAGE_ENABLED === "true",
  };
}

function detectClaudeCliLogin(): boolean {
  const result = spawnSync(config.anthropic.cliPath, ["auth", "status"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  try {
    const status = JSON.parse(result.stdout || "{}") as { loggedIn?: boolean };
    return status.loggedIn === true;
  } catch {
    return false;
  }
}
