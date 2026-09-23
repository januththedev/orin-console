# Orin Console

Real Linux terminal in the browser. Each session boots an **isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)** with a real tmux PTY — pipes, colors, `npm install`, dev servers with public URLs. **No shell emulation**: the frontend sends keystrokes, the shell interprets everything.

By **Orin AI** · Januth Nimnal · MIT · live at `console.orinai.org`

## How it works

```
browser (xterm.js) --keys--> POST /api/sessions/:id/input --send-keys--> tmux PTY in sandbox
browser <--SSE frames-- POST /api/sessions/:id/stream <--capture-pane-- tmux PTY
```

- Backend drives tmux: `new-session`, `send-keys -l` (literal), `capture-pane -p`, `resize-window`, `display-message #{pane_current_path}`.
- Exit codes: a bash `PROMPT_COMMAND` hook reports each command's status through tmux's native pane title (`display-message #{pane_title}`); the server fires `exit` events on change. Nothing leaks into the visible screen.
- Env vars are injected by the platform at sandbox create — never typed, never echoed, values masked in stored output.
- History (`console_events`: command/stdout/exit/resize/signal/system) replays on reload and for share guests.

## Session lifetime (Hobby truth)

Vercel Hobby caps sandbox `timeout` at **45 minutes** — a single sandbox cannot
live 24h. Console splits lifetime in two:

- **Session record** (history, shares, env names): **24h TTL**, enforced on every request.
- **Compute slice** (the sandbox): **≤ 40m**, then the platform kills it. The next
  API access **transparently renews** a fresh sandbox on the same session
  (`sandbox renewed` system event) — history and shares survive, the filesystem
   does not. Declared ports get fresh URLs after a renewal.

## Quickstart

1. `npm install`
2. Run `schema.sql` against your Neon DB (`DATABASE_URL`).
3. Copy `.env.example` → `.env.local`: `DATABASE_URL` + `TOKEN_ENCRYPTION_KEY` (must match Orin core's — console verifies the same session tokens; MCP registry `mcp_credentials` is read from the same DB).
4. Local sandbox auth: `vercel link` + `vercel env pull` (OIDC, 12h expiry).
5. `npx vercel dev` → open `/`, paste an Orin session token or `orin_mcp_…` credential → New session.

## API

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST/GET | `/api/sessions` | owner | create (cols/rows/env/ports) / list mine |
| GET/DELETE | `/api/sessions/:id` | owner | detail + 200 history events / destroy |
| POST | `/api/sessions/:id/input` | owner | `{text}` \| `{key}` \| `{cols,rows}` |
| POST | `/api/sessions/:id/stream` | owner | SSE frames ~50s, `{lastScreen,since}` |
| GET/POST/DELETE | `/api/sessions/:id/share` | owner | list / create `{mode}` (token once) / revoke |
| GET | `/api/s/:token` | guest | mode + TTL + history |
| POST | `/api/s/:token/input` | guest | terminal mode only |
| POST | `/api/s/:token/stream` | guest | same frame protocol |

Auth accepts **Orin session tokens** (HS256, revocation-checked) or **Orin MCP credentials** (registry-checked, fail-closed).

## Security model

- One sandbox per session; 24h TTL enforced **on every request** server-side AND by the platform (`timeout` at create). Expired → sandbox stopped, rows cascade-deleted, `410`.
- Share links default to nothing — owner picks `read` or `terminal` per link; tokens random 256-bit, sha256-stored, shown once, revocable.
- Secrets: AES-256-GCM in `console_env`, values masked in events/SSE, never logged, never returned.
- No cron needed: expiry is lazy (checked on access) + platform timeout as backstop.

## Verify

- PTY protocol proven live against a real sandbox: `tmux 3.6` session create, literal input, command output, cwd tracking, resize, SIGINT, env (see session notes).
- `npm run typecheck` must pass. Port URLs (`sandbox.domain(port)`) are SDK-typed but not yet exercised live (probe sandbox was deny-all).

## License

MIT — Januth Nimnal.
