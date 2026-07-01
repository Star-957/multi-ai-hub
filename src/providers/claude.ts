import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { config, configuredProviders } from "../config.js";
import { systemPrompt } from "../system-prompt.js";
import { toolDefinitions, type ToolExecutor } from "../tools.js";
import type { AgentResult, ProviderAdapter, RunContext, ToolRequest } from "../types.js";

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude" as const;
  private readonly client: Anthropic;

  constructor(private readonly executeTool: ToolExecutor) {
    if (!config.anthropic.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: config.requestTimeoutMs, maxRetries: 1 });
  }

  async run(prompt: string, context: RunContext): Promise<AgentResult> {
    const status = configuredProviders();
    const blocked = new Set(context.blockedProviders ?? []);
    const definitions = toolDefinitions(
      this.name,
      {
        openai: status.openai && !blocked.has("openai"),
        claude: status.claude && !blocked.has("claude"),
        gemini: status.gemini && !blocked.has("gemini"),
        ollama: status.ollama && !blocked.has("ollama"),
      },
      status.imageGeneration,
      context,
    );
    const tools: Tool[] = definitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Tool.InputSchema,
    }));
    const messages: MessageParam[] = [{ role: "user", content: prompt }];
    const artifacts: AgentResult["artifacts"] = [];

    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: config.maxOutputTokens,
        system: systemPrompt(this.name, context),
        messages,
        tools,
      });
      const calls = response.content.filter((block) => block.type === "tool_use");
      if (calls.length === 0) {
        // If the turn was cut at max_tokens (possibly before a tool_use was even emitted), the text
        // is a TRUNCATION, not a finished answer — surface it instead of returning a partial as if
        // it were the final deliverable (audit 2026-06-29 F2).
        if (response.stop_reason === "max_tokens") {
          throw new Error("Claude response was truncated at max_tokens (incomplete answer)");
        }
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        return {
          provider: this.name,
          text: text || "Claude returned no text.",
          artifacts,
          trace: context.trace,
        };
      }
      if (round === config.maxToolRounds) throw new Error("Claude exceeded the tool-round limit");

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = isRecord(call.input) ? call.input : {};
        const request: ToolRequest = { name: call.name, input };
        const result = await this.executeTool(request, this.name, context);
        if (result.artifacts) artifacts.push(...result.artifacts);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: result.content,
          is_error: !result.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("Claude tool loop ended unexpectedly");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
