import { spawn } from "node:child_process";
import { config, configuredProviders } from "../config.js";
import { systemPrompt } from "../system-prompt.js";
import { toolDefinitions, type ToolExecutor } from "../tools.js";
import type { AgentResult, ProviderAdapter, RunContext, ToolRequest } from "../types.js";

type CliAction = {
  action: "final" | "tool";
  text?: string;
  name?: string;
  prompt?: string;
};

const actionSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["final", "tool"] },
    text: { type: "string" },
    name: { type: "string" },
    prompt: { type: "string" },
  },
  required: ["action"],
  additionalProperties: false,
};

export class ClaudeCliAdapter implements ProviderAdapter {
  readonly name = "claude" as const;

  constructor(private readonly executeTool: ToolExecutor) {}

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
    const allowed = new Set(definitions.map((tool) => tool.name));
    const artifacts: AgentResult["artifacts"] = [];
    const history: string[] = [];

    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      const toolMenu = definitions.length
        ? definitions.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")
        : "- No tools are available in this turn.";
      const instruction = [
        systemPrompt(this.name, context),
        "Return exactly one structured action. Use action=final with text when done. Use action=tool with name and prompt to call one listed tool.",
        "Available tools:",
        toolMenu,
        "Original user request:",
        prompt,
        history.length ? `Tool history:\n${history.join("\n")}` : "No tools have been called yet.",
      ].join("\n\n");

      const output = await runClaudeCli(instruction);
      const action = parseAction(output);
      if (action.action === "final") {
        if (!action.text?.trim()) throw new Error("Claude CLI returned an empty final answer");
        return {
          provider: this.name,
          text: action.text.trim(),
          artifacts,
          trace: context.trace,
        };
      }
      if (round === config.maxToolRounds) throw new Error("Claude CLI exceeded the tool-round limit");
      if (!action.name || !allowed.has(action.name)) {
        throw new Error(`Claude CLI requested an unavailable tool: ${action.name ?? "(missing)"}`);
      }
      if (!action.prompt?.trim()) throw new Error("Claude CLI returned a tool action without a prompt");
      const request: ToolRequest = { name: action.name, input: { prompt: action.prompt.trim() } };
      const result = await this.executeTool(request, this.name, context);
      if (result.artifacts) artifacts.push(...result.artifacts);
      history.push(
        JSON.stringify({ tool: action.name, prompt: action.prompt, ok: result.ok, result: result.content }),
      );
    }
    throw new Error("Claude CLI tool loop ended unexpectedly");
  }
}

function runClaudeCli(input: string): Promise<string> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(actionSchema),
    "--model",
    config.anthropic.model,
    "--effort",
    config.anthropic.effort,
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(config.anthropic.cliPath, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill(); // SIGTERM
      // Escalate to SIGKILL if the CLI ignores SIGTERM, so it can't linger as an orphan after we
      // reject (audit 2026-06-29 F4). unref() so this guard timer never keeps the process alive.
      const killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }, 5_000);
      killTimer.unref();
      reject(new Error("Claude CLI timed out"));
    }, 10 * 60 * 1000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        const hint = /auth|login|oauth/i.test(err + out)
          ? " Run .\\login-claude.ps1 first to connect your Claude Max account."
          : "";
        reject(new Error(`Claude CLI failed: ${err || out || `exit ${code}`}.${hint}`));
      } else {
        resolve(out);
      }
    });
    child.stdin.end(input, "utf8");
  });
}

function parseAction(raw: string): CliAction {
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(raw);
  } catch {
    throw new Error("Claude CLI returned invalid JSON");
  }
  if (!wrapper || typeof wrapper !== "object") throw new Error("Claude CLI returned an invalid result");
  const object = wrapper as Record<string, unknown>;
  const candidate = object.structured_output ?? object.result;
  let action: unknown = candidate;
  if (typeof candidate === "string") {
    try {
      action = JSON.parse(candidate);
    } catch {
      action = { action: "final", text: candidate };
    }
  }
  if (!action || typeof action !== "object") throw new Error("Claude CLI returned no structured output");
  const parsed = action as CliAction;
  if (parsed.action !== "final" && parsed.action !== "tool") {
    throw new Error("Claude CLI returned an unknown action");
  }
  return parsed;
}
