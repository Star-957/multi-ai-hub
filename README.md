# Multi-AI Hub

Privacy-first local MCP hub for coordinating multiple AI providers from Claude Code.

The hub runs on your machine, exposes a small Model Context Protocol server, and lets a commander agent ask bounded questions to other providers without handing them your whole workspace. It supports local Ollama seats for private work, cloud seats for non-sensitive critique, and a structured council mode for independent review.

## Console and sharing

**A GitHub repository is source code, not a running console.** `localhost` and `127.0.0.1` always refer to the visitor's own computer. Sharing that address does not share your hub.

The repository includes the complete browser console in `public/`. There are two ways to use it:

| Mode | Run | What it does |
| --- | --- | --- |
| Local console | `pnpm start` | Runs on your computer and calls only providers you configure. Cloud requests may incur charges. |
| Public demo build | `pnpm build:demo` | Produces `dist/demo/`, an interactive static example with canned responses. No backend, keys, model calls or private files. |

Preview the demo with `pnpm preview:demo`, then open the local URL it prints. Demo and local modes are explicitly labelled. The demo works under a hosting subpath, such as `/multi-ai-hub/`, without contacting anyone's localhost. See [deployment and privacy boundaries](docs/deployment.md).

No hosted console URL is configured in this repository. A demo build does not itself publish a website.

## What It Does

- Exposes MCP tools for Claude Code: `ask_openai`, `ask_gemini`, `ask_ollama`, `ask_qwen`, `ask_llama_fast`, `council_review`, `multi_ai_status`, and optional cloud seats.
- Keeps API keys server-side in `.env`; they are never sent to the browser.
- Uses local Ollama seats for private review and offline fallback.
- Blocks obvious sensitive prompts from cloud seats with a fail-closed routing check.
- Supports optional OpenAI-compatible cloud reviewers: Groq, Cerebras, Mistral, OpenRouter, GLM, and NVIDIA NIM.
- Provides smoke tests and a secret/private marker scanner for safer sharing.
- Includes a responsive console with provider configuration status, sample prompts, in-memory output, copy/clear actions, and recoverable errors. Each request is independent; previous messages are not sent as conversation context.

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
git clone https://github.com/Star-957/multi-ai-hub.git
cd multi-ai-hub
pnpm install --frozen-lockfile
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

Open the URL printed by the server (default `http://127.0.0.1:8787`) **on that same computer**. You should see the console, not a 404. Keep the terminal running. Each person using the real console installs their own copy and supplies their own provider access.

For local inference, install/start Ollama separately and download the model named in `.env`. `OLLAMA_URL` accepts only a loopback HTTP(S) origin; remote endpoints and redirects are refused so seats labelled local stay on-machine. An empty value disables local seats. The console's **configured** label indicates settings are present; it is not a live connectivity or quota check. For Claude CLI, use the CLI's existing login. API providers need their own credentials and billing arrangements. Example model IDs may need updating to models available to your account.

`HOST` accepts only `127.0.0.1`, `localhost`, or `::1`; `PORT` must be an integer from 1 to 65535. Other bind addresses fail at startup. If startup reports the port is in use, stop the other instance or choose another local port.

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

The HTTP server rejects public bind addresses and cross-origin browser requests. It checks loopback peer/Host/Origin, requires JSON and a custom header for chat, limits input size, allows one active request and at most 10 model requests per minute, and hides raw provider exception details. These are local safeguards, not remote-user authentication or billing controls. Do not tunnel, reverse-proxy, or port-forward this server to the internet.

Only the allowlisted static demo is suitable for public hosting. A real shared service would need a separate authenticated backend, authorization, per-user credentials and spend controls, HTTPS, and an explicit privacy/retention design.

Sensitive prompts are blocked from obvious cloud routes, but the classifier is a guardrail, not a legal or security guarantee. Use local/private seats for identity, legal, financial, medical, credential, or proprietary content.

The UI stores no chat in browser storage. Reloading clears the display; provider-side retention still applies. Generated images are saved locally in `data/generated/` and are never included in the demo build. The app adds no analytics, external fonts, or remote image embeds.

## Local HTTP interface

- `GET /api/status` returns configuration flags, model metadata, `apiVersion: 1`, and `mode: "local"`; it does not test providers or return keys.
- `POST /api/chat` requires `Content-Type: application/json` and `X-Hub-Request: console`, with `{ "provider": "ollama", "message": "Explain sorting" }`. Browser calls must come from the console's exact origin. Maximum message length: 12,000 characters.
- Responses contain `text`, `artifacts`, and `trace`. Error responses use `{ "error": "…" }`; 400/413/415 indicate invalid input, 403 a safety rejection, 409 an unconfigured provider, 429 a busy/rate-limited hub, and 502 a provider failure. Provider errors are not retried automatically by the HTTP layer.
- The console uses same-origin relative API URLs. There is no public API URL or browser key field. See [local HTTP tests](test/http-server.test.ts).

Before publishing, forking, or sharing a modified copy:

```powershell
pnpm secret:scan
```

## Development

```powershell
pnpm typecheck
pnpm test
pnpm build:demo
pnpm audit --prod
pnpm secret:scan
```

Tests use provider stubs and do not require paid model calls. Smoke commands intentionally contact configured providers; run them only when you want those requests.

## License

MIT
