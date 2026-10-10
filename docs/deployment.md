# Sharing the console safely

## What is deployable

The hub is a local single-user application with access to provider credentials and, optionally, a logged-in Claude CLI. The real HTTP server must stay on loopback. Do not expose it using a tunnel, router forwarding, or a public reverse proxy.

The public option is a static demo. Visitors can select a model, try the composer, inspect a sample response and clear the display. Every response is labelled as a predefined example; it is not model inference. Inputs stay in the browser tab. The demo does not reach any localhost, backend, provider, file system, or chat history.

## Build and inspect

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:demo
pnpm secret:scan
pnpm secret:scan dist/demo
pnpm preview:demo
```

Open the printed preview URL on the same computer. Try a sample prompt and verify the “互動示範” badge and predefined-answer label. The preview server itself is local only.

`dist/demo/` contains exactly these four files:

- `index.html`
- `styles.css`
- `app.js`
- `runtime-config.js` (always `mode = "demo"`)

The build explicitly copies this allowlist. It never copies `.env`, `src/`, `node_modules/`, `.git/`, generated images, logs, memory, or transcripts. The output HTML sets `connect-src 'none'`, preventing fetch/WebSocket connections even if demo code accidentally attempts one. Assets use relative URLs and work at a site root or repository subpath. The build rejects unexpected stale output files and symbolic links.

## Publish to an existing static host

After reviewing the changes, upload **only `dist/demo/`** to an already approved static host. Do not upload the repository root or the Node server. No build-time environment variables, provider keys, authentication tokens, or server process are needed for the demo.

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) is a static hosting option included for public repositories on GitHub Free. If Pages is already approved and configured, use its static artifact publishing workflow and set the upload path to `dist/demo`. Hosting providers may maintain their own access logs. This change does not enable Pages, create hosting accounts, request new permissions, or deploy automatically from a pull request.

After deployment, verify the actual HTTPS URL in a browser: assets load under the deployed path, the badge says demo, a sample response works, there are no `/api/` or loopback requests, and private/backend paths return 404. Add a live link to the README only after those checks pass.

## If visitors need real model responses

They can clone the repository and run their own local hub with their own provider configuration. A hosted multi-user edition is a separate project: it needs authenticated users, authorization, a server-side secret store, per-user spend limits, request isolation and an explicit retention policy. Connecting a public website to this local control server is not a shortcut to that design.
