import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { config, configuredProviders } from "../config.js";
import { systemPrompt } from "../system-prompt.js";
import { toolDefinitions, type ToolExecutor } from "../tools.js";
import type { AgentResult, ProviderAdapter, RunContext, ToolRequest } from "../types.js";

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenAI;

  constructor(private readonly executeTool: ToolExecutor) {
    if (!config.gemini.apiKey) throw new Error("GEMINI_API_KEY is not configured");
    this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey, httpOptions: { timeout: config.requestTimeoutMs } });
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
    const functionDeclarations: FunctionDeclaration[] = definitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.inputSchema,
    }));
    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
    const artifacts: AgentResult["artifacts"] = [];

    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      const response = await this.client.models.generateContent({
        model: config.gemini.model,
        contents,
        config: {
          systemInstruction: systemPrompt(this.name, context),
          maxOutputTokens: config.maxOutputTokens,
          tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
        },
      });
      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        return {
          provider: this.name,
          text: response.text || "Gemini returned no text.",
          artifacts,
          trace: context.trace,
        };
      }
      if (round === config.maxToolRounds) throw new Error("Gemini exceeded the tool-round limit");

      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);
      const responseParts: Part[] = [];
      for (const call of calls) {
        const request: ToolRequest = {
          name: call.name ?? "",
          input: call.args ?? {},
        };
        const result = await this.executeTool(request, this.name, context);
        if (result.artifacts) artifacts.push(...result.artifacts);
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: result.ok ? { output: result.content } : { error: result.content },
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }
    throw new Error("Gemini tool loop ended unexpectedly");
  }
}
