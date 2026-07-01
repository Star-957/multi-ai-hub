export const PROVIDERS = ["openai", "claude", "gemini", "ollama"] as const;

export type Provider = (typeof PROVIDERS)[number];

export type Artifact = {
  type: "image";
  url: string;
  prompt: string;
};

export type TraceEntry = {
  at: string;
  provider: Provider | "system";
  event: "start" | "delegate" | "tool" | "complete" | "error";
  detail: string;
  depth: number;
};

export type AgentResult = {
  provider: Provider;
  text: string;
  artifacts: Artifact[];
  trace: TraceEntry[];
};

export type RunContext = {
  depth: number;
  maxDepth: number;
  path: Provider[];
  trace: TraceEntry[];
  blockedProviders?: Provider[];
};

export type ToolRequest = {
  name: string;
  input: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  content: string;
  artifacts?: Artifact[];
};

export interface ProviderAdapter {
  readonly name: Provider;
  run(prompt: string, context: RunContext): Promise<AgentResult>;
}
