import { claudeCliStatus, config, configuredProviders } from "./config.js";
import { ImageGenerator } from "./image-generator.js";
import { ClaudeAdapter } from "./providers/claude.js";
import { ClaudeCliAdapter } from "./providers/claude-cli.js";
import { GeminiAdapter } from "./providers/gemini.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { OllamaAdapter } from "./providers/ollama.js";
import { readPrompt } from "./tools.js";
import { configuredSeats, SEATS, seatModel, type SeatId } from "./seats.js";
import { PROVIDERS } from "./types.js";
import type {
  AgentResult,
  Provider,
  ProviderAdapter,
  RunContext,
  ToolRequest,
  ToolResult,
  TraceEntry,
} from "./types.js";

export class MultiAIHub {
  private readonly adapters = new Map<Provider, ProviderAdapter>();
  private readonly imageGenerator = new ImageGenerator();

  constructor() {
    const execute = this.executeTool.bind(this);
    if (config.openai.apiKey) this.adapters.set("openai", new OpenAIAdapter(execute));
    if (config.anthropic.transport === "api" && config.anthropic.apiKey) {
      this.adapters.set("claude", new ClaudeAdapter(execute));
    }
    if (config.anthropic.transport === "cli" && configuredProviders().claude) {
      this.adapters.set("claude", new ClaudeCliAdapter(execute));
    }
    if (config.gemini.apiKey) this.adapters.set("gemini", new GeminiAdapter(execute));
    if (configuredProviders().ollama) this.adapters.set("ollama", new OllamaAdapter());
  }

  status() {
    const seats = configuredSeats();
    const councilSeats = Object.fromEntries(
      (Object.keys(SEATS) as SeatId[]).map((id) => [
        id,
        {
          configured: seats[id],
          title: SEATS[id].title,
          locality: SEATS[id].locality,
          model: seatModel(id),
          inDefaultCouncil: SEATS[id].inDefaultCouncil,
        },
      ]),
    );

    return {
      ...configuredProviders(),
      models: {
        openai: config.openai.model,
        claude: config.anthropic.model,
        gemini: config.gemini.model,
        ollama: config.ollama.model,
        image: config.openai.imageModel,
      },
      transports: {
        openai: "api",
        claude: config.anthropic.transport,
        gemini: "api",
        ollama: "local",
      },
      claudeCli: claudeCliStatus,
      seats,
      councilSeats,
      limits: {
        maxDelegationDepth: config.maxDelegationDepth,
        maxToolRounds: config.maxToolRounds,
      },
    };
  }

  async chat(
    provider: Provider,
    prompt: string,
    options?: { blockedProviders?: Provider[] },
  ): Promise<AgentResult> {
    const context: RunContext = {
      depth: 0,
      maxDepth: config.maxDelegationDepth,
      path: [],
      trace: [],
      blockedProviders: options?.blockedProviders,
    };
    return this.dispatch(provider, prompt, context);
  }

  private async dispatch(provider: Provider, prompt: string, parent: RunContext): Promise<AgentResult> {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`${provider} is not configured`);

    const context: RunContext = { ...parent, path: [...parent.path, provider] };
    this.trace(context, provider, "start", `Started ${provider}`, context.depth);
    try {
      const result = await adapter.run(prompt, context);
      this.trace(context, provider, "complete", `Completed ${provider}`, context.depth);
      return { ...result, trace: context.trace };
    } catch (error) {
      this.trace(context, provider, "error", errorMessage(error), context.depth);
      throw error;
    }
  }

  private async executeTool(
    request: ToolRequest,
    current: Provider,
    context: RunContext,
  ): Promise<ToolResult> {
    try {
      const prompt = readPrompt(request);
      if (request.name === "generate_image") {
        this.trace(context, current, "tool", "Generating image with OpenAI", context.depth);
        const artifact = await this.imageGenerator.generate(prompt);
        return { ok: true, content: JSON.stringify(artifact), artifacts: [artifact] };
      }

      if (request.name.startsWith("ask_")) {
        const target = request.name.slice(4) as Provider;
        if (!(PROVIDERS as readonly string[]).includes(target)) {
          throw new Error(`Unknown provider tool: ${request.name}`);
        }
        if (target === current) throw new Error("An agent cannot delegate to itself");
        if (context.depth >= context.maxDepth) throw new Error("Maximum delegation depth reached");
        // Defense-in-depth: enforce blockedProviders at the execution chokepoint,
        // not only by omitting the tool from the advertised list (defense-in-depth vs side-channel/recursion).
        if (context.blockedProviders?.includes(target)) throw new Error(`delegation to ${target} is blocked in this context`);
        this.trace(context, current, "delegate", `${current} → ${target}`, context.depth);
        const result = await this.dispatch(target, prompt, {
          ...context,
          depth: context.depth + 1,
        });
        return {
          ok: true,
          content: result.text,
          artifacts: result.artifacts,
        };
      }
      throw new Error(`Unknown tool: ${request.name}`);
    } catch (error) {
      return { ok: false, content: classifyProviderError(error) };
    }
  }

  private trace(
    context: RunContext,
    provider: TraceEntry["provider"],
    event: TraceEntry["event"],
    detail: string,
    depth: number,
  ) {
    context.trace.push({ at: new Date().toISOString(), provider, event, detail, depth });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Classify a provider failure so the commander gets a machine-readable redirect
// instead of a raw SDK error string. Pure message inspection — never reads memory,
  // never auto-retries, never spawns.
function classifyProviderError(error: unknown): string {
  const message = errorMessage(error);
  if (/(^|\D)(429|401)(\D|$)|quota|rate.?limit|insufficient|billing|invalid_api_key|authentication|unauthorized/i.test(message)) {
    return (
      `${message}\n\n` +
      "[provider unavailable — quota/auth] 呢個 provider 暫時用唔到(配額 / billing / 認證)。" +
      "唔好重試同一個;改用 ask_ollama(本機免費、live)或 ask_gemini 完成同一任務。" +
      "(注:ChatGPT 訂閱唔包 OpenAI API credit。)"
    );
  }
  return message;
}
