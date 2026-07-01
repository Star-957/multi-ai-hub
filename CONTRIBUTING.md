# Contributing

Thanks for checking out Multi-AI Hub.

## Development Setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm typecheck
pnpm test
```

Provider keys are optional for most tests. Do not commit `.env`.

## Pull Request Checklist

- Keep changes scoped.
- Add or update tests for behavior changes.
- Run `pnpm typecheck`.
- Run `pnpm test`.
- Run `pnpm secret:scan`.
- Do not include personal memory, transcripts, generated outputs, provider credentials, or private project data.

## Provider Changes

Cloud providers must stay dormant until explicitly configured. Tool descriptions should warn users not to send sensitive content to cloud seats.
