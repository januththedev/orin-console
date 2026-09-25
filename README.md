# Orin Console

Real Linux shell sessions in the browser. Each session receives an isolated Vercel Sandbox and a real tmux PTY; the browser is a terminal client, not a shell emulator.

## Architecture

```text
xterm.js
  -> authenticated /api/sessions/:id/input
  -> Vercel Sandbox tmux send-keys (argument array, no host shell)
  <- ANSI-preserving capture-pane -e
  <- reconnectable SSE frames + persisted event IDs
```

- Input, keys, and resize operations are serialized per session so browser requests cannot reorder shell input.
- ANSI escape sequences are preserved for xterm rendering.
- Exit codes come from a bash prompt hook through tmux pane title and emit only when changed.
- Declared ports and their sandbox URLs are persisted and recreated when compute renews.
- A daily protected cleanup route removes expired session metadata; every access also rejects expired sessions immediately.

## Authentication

Console does not query Core's old raw token tables. It sends the current credential to Orin Core:

- session credentials: `/api/auth/session/introspect`
- MCP credentials: `/api/auth/mcp/verify`

Only session credentials can own a terminal. MCP credentials cannot be used to create a shell. Browser login tokens are held in `sessionStorage`, not persistent local storage.

## Sessions and sharing

- Session record: 24 hours, enforced on every request.
- Sandbox compute slice: platform-limited lifetime, renewed transparently on access; filesystem is fresh after renewal, while metadata/history/shares survive.
- Environment values are encrypted at rest and masked in stored output. Terminal sharing is rejected for sessions with injected environment values because a shell viewer cannot safely guarantee secret non-disclosure.
- Share tokens are 256-bit random values stored as hashes and shown once.

## Local verification

```bash
npm ci
npm run check
```

Tests are static/contract tests and do not create a paid sandbox. TypeScript compilation covers the Vercel functions.

## Deployment

The public Vercel app hosts the UI and session metadata. Sandbox execution remains in Vercel Sandbox compute, not in a short-lived Function process. The API uses a maximum 60-second request window and an external daily cleanup cron.

## API

- `POST/GET /api/sessions` — create/list owned sessions
- `GET/DELETE /api/sessions/:id` — detail/history/destroy
- `POST /api/sessions/:id/input` — text, key, or resize
- `POST /api/sessions/:id/stream` — reconnectable SSE frames
- `/api/sessions/:id/share` — list/create/revoke
- `/api/s/:token` and terminal subroutes — scoped share access

## License

MIT — Januth Nimnal
