import { MultiAIHub } from "../src/hub.js";

const hub = new MultiAIHub();
const status = hub.status();

console.log(
  JSON.stringify(
    {
      configured: {
        openai: status.openai,
        claude: status.claude,
        gemini: status.gemini,
        imageGeneration: status.imageGeneration,
      },
      models: status.models,
      claudeCli: status.claudeCli,
    },
    null,
    2,
  ),
);

let failed = false;
for (const provider of ["openai", "gemini"] as const) {
  if (!status[provider]) {
    console.error(`${provider}: not configured`);
    failed = true;
    continue;
  }

  try {
    const result = await hub.chat(provider, "Connection test. Reply with exactly: OK");
    const reply = result.text.trim().replace(/\s+/g, " ").slice(0, 120);
    console.log(`${provider}: ${reply || "empty response"}`);
    if (!reply) failed = true;
  } catch (error) {
    console.error(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
