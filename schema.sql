-- Orin Console schema. Run once against DATABASE_URL (Neon).
-- Tables are namespaced console_* so sharing the Orin core DB is safe.

CREATE TABLE IF NOT EXISTS console_sessions (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  cwd TEXT NOT NULL DEFAULT '~',
  cols INT NOT NULL DEFAULT 100,
  rows INT NOT NULL DEFAULT 30,
  ports INT[] NOT NULL DEFAULT '{}',
  env_names TEXT[] NOT NULL DEFAULT '{}',
  last_exit INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE console_sessions ADD COLUMN IF NOT EXISTS ports INT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS console_sessions_owner_idx ON console_sessions (owner_uid);
CREATE INDEX IF NOT EXISTS console_sessions_expires_idx ON console_sessions (expires_at);

CREATE TABLE IF NOT EXISTS console_env (
  session_id TEXT PRIMARY KEY REFERENCES console_sessions (id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS console_shares (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES console_sessions (id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('read', 'terminal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS console_shares_session_idx ON console_shares (session_id);

CREATE TABLE IF NOT EXISTS console_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES console_sessions (id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS console_events_session_idx ON console_events (session_id, id);

-- Expired sessions and their dependent rows are removed by the scheduled
-- cleanup worker. Access checks still enforce expiry immediately.
