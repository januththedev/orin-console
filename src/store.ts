import { sql } from './db.js';
import { MAX_EVENTS_PER_SESSION, type ConsoleSession, type EventType, type HistoryEvent } from './types.js';

function row(r: Record<string, unknown>): ConsoleSession {
  return {
    id: r.id as string,
    ownerUid: r.owner_uid as string,
    sandboxId: r.sandbox_id as string,
    cwd: r.cwd as string,
    cols: r.cols as number,
    rows: r.rows as number,
    envNames: (r.env_names as string[]) ?? [],
    lastExit: (r.last_exit as number | null) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    expiresAt: (r.expires_at as Date).toISOString(),
    lastActiveAt: (r.last_active_at as Date).toISOString(),
  };
}

export async function insertSession(s: {
  id: string;
  ownerUid: string;
  sandboxId: string;
  cwd: string;
  cols: number;
  rows: number;
  expiresAt: Date;
}): Promise<ConsoleSession> {
  const rows = await sql`
    INSERT INTO console_sessions (id, owner_uid, sandbox_id, cwd, cols, rows, expires_at)
    VALUES (${s.id}, ${s.ownerUid}, ${s.sandboxId}, ${s.cwd}, ${s.cols}, ${s.rows}, ${s.expiresAt.toISOString()})
    RETURNING *`;
  return row(rows[0] as Record<string, unknown>);
}

export async function getSession(id: string): Promise<ConsoleSession | null> {
  const rows = await sql`SELECT * FROM console_sessions WHERE id = ${id} LIMIT 1`;
  return rows.length ? row(rows[0] as Record<string, unknown>) : null;
}

export async function listSessions(ownerUid: string): Promise<ConsoleSession[]> {
  const rows = await sql`SELECT * FROM console_sessions WHERE owner_uid = ${ownerUid} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => row(r as Record<string, unknown>));
}

export async function touchSession(
  id: string,
  patch?: { cwd?: string; cols?: number; rows?: number; lastExit?: number | null },
): Promise<void> {
  if (patch?.cwd !== undefined || patch?.cols !== undefined || patch?.rows !== undefined || patch?.lastExit !== undefined) {
    await sql`UPDATE console_sessions SET last_active_at = now(),
      cwd = COALESCE(${patch.cwd ?? null}, cwd),
      cols = COALESCE(${patch.cols ?? null}, cols),
      rows = COALESCE(${patch.rows ?? null}, rows),
      last_exit = COALESCE(${patch.lastExit ?? null}, last_exit)
      WHERE id = ${id}`;
  } else {
    await sql`UPDATE console_sessions SET last_active_at = now() WHERE id = ${id}`;
  }
}

export async function setEnvNames(id: string, names: string[]): Promise<void> {
  await sql`UPDATE console_sessions SET env_names = ${names}, last_active_at = now() WHERE id = ${id}`;
}

/** Point a session at a fresh sandbox after transparent renewal. */
export async function setSandboxName(id: string, sandboxName: string): Promise<void> {
  await sql`UPDATE console_sessions SET sandbox_id = ${sandboxName}, last_active_at = now() WHERE id = ${id}`;
}

export async function deleteSession(id: string): Promise<void> {
  await sql`DELETE FROM console_sessions WHERE id = ${id}`;
}

export async function setEnvPayload(sessionId: string, payload: string): Promise<void> {
  await sql`INSERT INTO console_env (session_id, payload) VALUES (${sessionId}, ${payload})
    ON CONFLICT (session_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`;
}

export async function getEnvPayload(sessionId: string): Promise<string | null> {
  const rows = await sql`SELECT payload FROM console_env WHERE session_id = ${sessionId} LIMIT 1`;
  return rows.length ? (rows[0].payload as string) : null;
}

export async function appendEvent(sessionId: string, type: EventType, data: Record<string, unknown>): Promise<void> {
  await sql`INSERT INTO console_events (session_id, type, data) VALUES (${sessionId}, ${type}, ${JSON.stringify(data)})`;
  await sql`DELETE FROM console_events WHERE session_id = ${sessionId}
    AND id NOT IN (SELECT id FROM console_events WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT ${MAX_EVENTS_PER_SESSION})`;
}

export async function listEvents(sessionId: string, afterId = 0, limit = 200): Promise<HistoryEvent[]> {
  const rows = await sql`SELECT id, at, type, data FROM console_events
    WHERE session_id = ${sessionId} AND id > ${afterId} ORDER BY id ASC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id as number,
    at: (r.at as Date).toISOString(),
    type: r.type as EventType,
    data: r.data as Record<string, unknown>,
  }));
}

export async function insertShare(tokenHash: string, sessionId: string, mode: 'read' | 'terminal'): Promise<void> {
  await sql`INSERT INTO console_shares (token_hash, session_id, mode) VALUES (${tokenHash}, ${sessionId}, ${mode})`;
}

export async function getShare(tokenHash: string): Promise<{ sessionId: string; mode: string } | null> {
  const rows = await sql`SELECT session_id, mode FROM console_shares WHERE token_hash = ${tokenHash} LIMIT 1`;
  return rows.length ? { sessionId: rows[0].session_id as string, mode: rows[0].mode as string } : null;
}

export async function deleteShare(tokenHash: string, sessionId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM console_shares WHERE token_hash = ${tokenHash} AND session_id = ${sessionId} RETURNING token_hash`;
  return rows.length > 0;
}

export async function listShares(sessionId: string): Promise<{ mode: string; createdAt: string }[]> {
  const rows = await sql`SELECT mode, created_at FROM console_shares WHERE session_id = ${sessionId} ORDER BY created_at DESC`;
  return rows.map((r) => ({ mode: r.mode as string, createdAt: (r.created_at as Date).toISOString() }));
}
