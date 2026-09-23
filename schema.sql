-- Orin Console schema. Run once against DATABASE_URL (Neon).
-- Tables are namespaced console_* so sharing the Orin core DB is safe.

CREATE TABLE IF NOT EXISTS console_sessions (
  id TEXT PRIMARY KEY,                    -- cns_<nanoid>
  owner_uid TEXT NOT NULL,                -- Orin uid from verified session/MCP token
  sandbox_id TEXT NOT NULL,               -- Vercel Sandbox NAME (lookup key), unique per session
  cwd TEXT NOT NULL DEFAULT '~',
  cols INT NOT NULL DEFAULT 100,
  rows INT NOT NULL DEFAULT 30,
  env_names TEXT[] NOT NULL DEFAULT '{}', -- secret NAMES only; values encrypted in console_env
  last_exit INT,                          -- last seen exit code (exit events fire on change)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,        -- created_at + 24h; enforced on EVERY access
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS console_sessions_owner_idx ON console_sessions (owner_uid);
CREATE INDEX IF NOT EXISTS console_sessions_expires_idx ON console_sessions (expires_at);

CREATE TABLE IF NOT EXISTS console_env (
  session_id TEXT PRIMARY KEY REFERENCES console_sessions (id) ON DELETE CASCADE,
  payload TEXT NOT NULL,                  -- AES-GCM JSON {name: value}; never logged, never in events
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS console_shares (
  token_hash TEXT PRIMARY KEY,            -- sha256 of the cst_ token (token shown once)
  session_id TEXT NOT NULL REFERENCES console_sessions (id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('read', 'terminal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS console_shares_session_idx ON console_shares (session_id);

CREATE TABLE IF NOT EXISTS console_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES console_sessions (id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- command | stdout | resize | signal | exit | system | env
  type TEXT NOT NULL,
  data JSONB NOT NULL                     -- secret values masked before insert
);
CREATE INDEX IF NOT EXISTS console_events_session_idx ON console_events (session_id, id);
