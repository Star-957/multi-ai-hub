# Security Policy

## Supported Versions

This project is early-stage. Security fixes target the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for secrets, credential leaks, or exploitable vulnerabilities.

If GitHub private vulnerability reporting is enabled for this repository, use that. Otherwise, open a minimal issue asking for a private contact path and do not include exploit details.

## Scope

This project is designed as a local single-user MCP hub. It is not safe to expose directly to the public internet without adding authentication, authorization, HTTPS, rate limits, audit logs, and spend controls.

Never commit `.env`, API keys, OAuth tokens, cookies, chat transcripts, private memory files, or generated data. Run:

```powershell
pnpm secret:scan
```

before publishing or sharing changes.
