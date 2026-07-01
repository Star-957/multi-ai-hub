# NVIDIA NIM Provider

This hub supports NVIDIA NIM as an optional OpenAI-compatible cloud council seat.

## Setup

1. Sign in to NVIDIA Build.
2. Open the Llama 3.3 70B Instruct model page.
3. Generate an API key.
4. Add it to `.env`:

   ```env
   NVIDIA_API_KEY=
   NVIDIA_MODEL=meta/llama-3.3-70b-instruct
   NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
   ```

5. Restart the MCP server / Claude Code session.
6. Run:

   ```powershell
   pnpm smoke:cloud-seats
   ```

## Privacy

NVIDIA is a cloud seat. Do not send identity, banking, legal, proprietary, credential, private companion, or other sensitive content to it. The hub's sensitivity gates block obvious sensitive prompts, but user judgment still matters.

## References

- NVIDIA NIM LLM API reference: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- Llama 3.3 70B Instruct on NVIDIA Build: https://build.nvidia.com/meta/llama-3_3-70b-instruct
