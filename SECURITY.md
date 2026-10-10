# Security Policy

## Supported Versions

This project is early-stage. Security fixes target the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for secrets, credential leaks, or exploitable vulnerabilities.

If GitHub private vulnerability reporting is enabled for this repository, use that. Otherwise, open a minimal issue asking for a private contact path and do not include exploit details.

## Scope

This project is designed as a local single-user MCP hub. It is not safe to expose directly to the public internet without adding authentication, authorization, HTTPS, rate limits, audit logs, and spend controls.

The local HTTP listener accepts only loopback addresses. Host, Origin, Fetch Metadata and a required JSON/custom-header chat request guard against cross-site use. No CORS access is granted. These checks do not authenticate local software; a malicious process already running on the computer remains outside this boundary. Do not put the listener behind a public proxy or tunnel.

Public hosting is supported only for the static demo built with `pnpm build:demo`. Its four-file allowlist includes no backend, credentials, generated data or transcripts, and its CSP disables network API connections. See [deployment instructions](docs/deployment.md).

The browser shows configuration status rather than verified provider health. Cloud providers can receive and retain explicitly submitted non-sensitive prompts; the sensitivity classifier is conservative but cannot recognize every secret or private detail. Local model endpoints and credentials should be configured only for services you trust.

Never commit `.env`, API keys, OAuth tokens, cookies, chat transcripts, private memory files, or generated data. Run:

```powershell
pnpm secret:scan
```

before publishing or sharing changes.
