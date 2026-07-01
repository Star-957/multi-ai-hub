# Multi-AI Hub

Privacy-first local MCP hub for coordinating multiple AI providers from Claude Code.

The hub runs on your machine, exposes a small Model Context Protocol server, and lets a commander agent ask bounded questions to other providers without handing them your whole workspace. It supports local Ollama seats for private work, cloud seats for non-sensitive critique, and a structured council mode for independent review.

## What It Does

- Exposes MCP tools for Claude Code: `ask_openai`, `ask_gemini`, `ask_ollama`, `ask_qwen`, `ask_llama_fast`, `council_review`, `multi_ai_status`, and optional cloud seats.
- Keeps API keys server-side in `.env`; they are never sent to the browser.
- Uses local Ollama seats for private review and offline fallback.
- Blocks obvious sensitive prompts from cloud seats with a fail-closed routing check.
- Supports optional OpenAI-compatible cloud reviewers: Groq, Cerebras, Mistral, OpenRouter, GLM, and NVIDIA NIM.
- Provides smoke tests and a secret/private marker scanner for safer sharing.

## Providers

Base providers:

- Claude via Claude Code CLI / Claude Max, or Anthropic API
- OpenAI API
- Gemini API
- Ollama local models

Council seats:

- Local: Qwen 30B, fast local seat, manual DeepSeek
- Cloud: Gemini, Groq, Cerebras, Mistral, OpenRouter, GLM, NVIDIA NIM

Cloud seats are dormant until their matching API key is set.

## Quick Start

Requirements:

- Node.js 20+
- pnpm
- Claude Code installed or available through this package
- Optional: Ollama for local seats

Install and configure:

```powershell
pnpm install
Copy-Item .env.example .env
```

Add provider keys to `.env` as needed:

```env
GEMINI_API_KEY=
OPENAI_API_KEY=
NVIDIA_API_KEY=
OLLAMA_URL=http://127.0.0.1:11434
```

Start the local HTTP server:

```powershell
pnpm start
```

Run the MCP server from Claude Code by pointing your MCP config at:

```powershell
node node_modules/tsx/dist/cli.mjs src/mcp-server.ts
```

## MCP Tools

Always registered:

- `ask_openai`
- `ask_gemini`
- `ask_ollama`
- `ask_qwen`
- `ask_llama_fast`
- `ask_deepseek`
- `council_review`
- `multi_ai_status`

Conditionally registered when configured:

- `generate_image`
- `ask_groq`
- `ask_cerebras`
- `ask_mistral`
- `ask_openrouter`
- `ask_glm`
- `ask_nvidia`

`multi_ai_status` reports provider availability, model names, Claude CLI status, and council seat metadata without exposing secrets.

## NVIDIA NIM

NVIDIA NIM is supported as an OpenAI-compatible cloud seat. See [docs/providers/nvidia.md](docs/providers/nvidia.md).

Default values:

```env
NVIDIA_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

Smoke-test configured cloud seats:

```powershell
pnpm smoke:cloud-seats
```

## Safety Model

This is a local single-user tool, not a hosted multi-tenant service.

Do not bind it to `0.0.0.0` or expose it publicly without adding authentication, authorization, HTTPS, rate limits, audit logs, and per-user spend controls.

Sensitive prompts are blocked from obvious cloud routes, but the classifier is a guardrail, not a legal or security guarantee. Use local/private seats for identity, legal, financial, medical, credential, or proprietary content.

Before publishing, forking, or sharing a modified copy:

```powershell
pnpm secret:scan
```

## Development

```powershell
pnpm typecheck
pnpm test
pnpm audit --prod
pnpm secret:scan
```

## License

MIT
