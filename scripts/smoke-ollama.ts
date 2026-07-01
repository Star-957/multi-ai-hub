import { MultiAIHub } from "../src/hub.js";

const hub = new MultiAIHub();
const result = await hub.chat("ollama", "Reply with exactly OK and nothing else.", {
  blockedProviders: ["openai", "claude", "gemini"],
});

if (result.text.trim() !== "OK") {
  throw new Error(`Unexpected Ollama response: ${result.text}`);
}

console.log(`Ollama smoke test passed (${result.provider}: ${result.text.trim()})`);
