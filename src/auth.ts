import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOKEN_KEY } from './config.js';
import { unauthorized } from './errors.js';
import { sql } from './db.js';
import type { Owner } from './types.js';

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify an Orin session token (same HS256 format the Orin core issues:
 * header.payload.signature, iss 'orin'). Minimal local verify — the session
 * row itself (revocation) lives in the core DB, checked below.
 */
function verifySessionToken(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('Invalid session');
  const [h, p, s] = parts;
  let header: { alg?: string };
  let payload: { iss?: string; uid?: string; exp?: number; sid?: string };
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    throw unauthorized('Invalid session');
  }
  if (header.alg !== 'HS256' || payload.iss !== 'orin' || typeof payload.uid !== 'string') {
    throw unauthorized('Invalid session');
  }
  const key = TOKEN_KEY();
  const expect = createHmac('sha256', key).update(`${h}.${p}`).digest();
  const got = b64urlDecode(s);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) throw unauthorized('Invalid session');
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) throw unauthorized('Session expired');
  return payload.uid;
}

/** Session revocation lives in the core `sessions` table (shared DB). Fail closed. */
async function sessionRevoked(token: string): Promise<boolean> {
  try {
    const rows = await sql`SELECT revoked FROM sessions WHERE token = ${token} LIMIT 1`;
    if (rows.length === 0) return true; // unknown token
    return rows[0].revoked === true;
  } catch {
    return true; // DB unreachable -> deny
  }
}

/**
 * Verify an Orin MCP credential (`orin_mcp_...`). Registry lives in the core
 * DB (`mcp_credentials`): jti lookup, sha256 compare, expiry + revocation.
 */
async function verifyMcpToken(token: string): Promise<string> {
  if (!token.startsWith('orin_mcp_')) throw unauthorized('Invalid credential');
  const { createHash } = await import('node:crypto');
  const secret = token.slice('orin_mcp_'.length);
  const jti = secret.split('.')[0];
  if (!jti) throw unauthorized('Invalid credential');
  const hash = createHash('sha256').update(secret).digest('hex');
  try {
    const rows = await sql`
      SELECT user_id, secret_hash, expires_at, revoked_at FROM mcp_credentials WHERE jti = ${jti} LIMIT 1`;
    if (rows.length === 0) return Promise.reject(unauthorized('Invalid credential'));
    const r = rows[0] as { user_id: string; secret_hash: string; expires_at: string; revoked_at: string | null };
    const a = Buffer.from(r.secret_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized('Invalid credential');
    if (r.revoked_at || new Date(r.expires_at).getTime() < Date.now()) throw unauthorized('Credential revoked or expired');
    return r.user_id;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw unauthorized('Authentication unavailable');
  }
}

function bearer(req: Request): string {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) throw unauthorized('Missing bearer token');
  return m[1];
}

/**
 * Owner auth: accepts an Orin session token OR an Orin MCP credential.
 * Sessions are checked for revocation; MCP tokens against the registry.
 */
export async function requireOwner(req: Request): Promise<Owner> {
  const token = bearer(req);
  if (token.startsWith('orin_mcp_')) {
    return { uid: await verifyMcpToken(token), kind: 'mcp' };
  }
  const uid = verifySessionToken(token);
  if (await sessionRevoked(token)) throw unauthorized('Session revoked');
  return { uid, kind: 'session' };
}
