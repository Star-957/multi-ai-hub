import OpenAI from "openai";
import type { ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { config, configuredProviders } from "../config.js";
import { systemPrompt } from "../system-prompt.js";
import { toolDefinitions, type ToolExecutor } from "../tools.js";
import type { AgentResult, ProviderAdapter, RunContext, ToolRequest } from "../types.js";

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(private readonly executeTool: ToolExecutor) {
    if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY is not configured");
    this.client = new OpenAI({ apiKey: config.openai.apiKey, timeout: config.requestTimeoutMs, maxRetries: 0 });
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
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: true,
    }));

    const artifacts: AgentResult["artifacts"] = [];
    let previousResponseId: string | undefined;
    let input: string | ResponseInputItem[] = prompt;

    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      const response = await this.client.responses.create({
        model: config.openai.model,
        instructions: systemPrompt(this.name, context),
        input,
        tools,
        tool_choice: "auto",
        previous_response_id: previousResponseId,
      });
      const calls = response.output.filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        // Surface a failed/truncated generation instead of reporting it as an empty success
        // (audit 2026-06-29 F3): the Responses API returns HTTP 200 even when content was filtered,
        // truncated (status "incomplete"), or carries a populated error.
        if (response.error) {
          throw new Error(`OpenAI response error: ${response.error.message ?? response.error.code ?? "unknown"}`);
        }
        if (response.status === "incomplete") {
          throw new Error(`OpenAI response incomplete: ${response.incomplete_details?.reason ?? "unknown"}`);
        }
        return {
          provider: this.name,
          text: response.output_text || "OpenAI returned no text.",
          artifacts,
          trace: context.trace,
        };
      }
      if (round === config.maxToolRounds) throw new Error("OpenAI exceeded the tool-round limit");

      const outputs: ResponseInputItem[] = [];
      for (const call of calls) {
        const request: ToolRequest = {
          name: call.name,
          input: parseArguments(call.arguments),
        };
        const result = await this.executeTool(request, this.name, context);
        if (result.artifacts) artifacts.push(...result.artifacts);
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ ok: result.ok, content: result.content }),
        });
      }
      previousResponseId = response.id;
      input = outputs;
    }
    throw new Error("OpenAI tool loop ended unexpectedly");
  }
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Give the tool executor a useful validation error below.
  }
  return {};
}
