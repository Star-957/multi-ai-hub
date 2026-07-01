import { PROVIDERS, type Provider, type RunContext, type ToolRequest, type ToolResult } from "./types.js";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const promptSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "A self-contained request for the other AI, including all context it needs.",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
};

export function toolDefinitions(
  current: Provider,
  available: Record<Provider, boolean>,
  canGenerateImages: boolean,
  context: RunContext,
): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];

  if (context.depth < context.maxDepth) {
    for (const provider of PROVIDERS) {
      if (provider === current || !available[provider]) continue;
      definitions.push({
        name: `ask_${provider}`,
        description:
          `Delegate a useful, bounded subtask to ${provider}. Use it when that provider offers a complementary opinion or capability. ` +
          "Ask it for what you might be missing — hidden risks, counterexamples, a simpler alternative, or genuinely new information — not a restatement of your own answer.",
        inputSchema: promptSchema,
      });
    }
  }

  if (canGenerateImages) {
    definitions.push({
      name: "generate_image",
      description:
        "Generate a new image with OpenAI's image model. Use this when the user asks for a visual asset. " +
        "The result contains a local image URL that must be included in the final answer.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed visual description, composition, style, lighting, and any exact text to render.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    });
  }

  return definitions;
}

export function readPrompt(request: ToolRequest): string {
  const prompt = request.input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error(`${request.name} requires a non-empty prompt`);
  }
  if (prompt.length > 30_000) {
    throw new Error(`${request.name} prompt is too long`);
  }
  return prompt.trim();
}

export type ToolExecutor = (
  request: ToolRequest,
  current: Provider,
  context: RunContext,
) => Promise<ToolResult>;
