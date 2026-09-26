import { unauthorized } from './errors.js';
import type { Owner } from './types.js';

function bearer(req: Request): string | null {
  const raw = req.headers.get('authorization');
  // An absent header means "keyless". A present but unparseable one is an
  // error: silently downgrading it to anonymous would hand a client that
  // believes it is signed in the anonymous experience instead of a clear signal.
  if (raw === null) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~-]{40,4096})$/.exec(raw.trim());
  if (!match) throw unauthorized('Malformed authorization header');
  return match[1];
}
function coreUrl(): string { const value = process.env.ORIN_CORE_URL || 'https://orinai.org'; const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw unauthorized('Core URL is not trusted'); return url.origin; }
async function verify(token: string): Promise<Owner> { const origin = coreUrl(); const session = await fetch(`${origin}/api/auth/session/introspect`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => null); if (session?.ok) { const body = await session.json() as { uid?: unknown; kind?: unknown }; if (body.kind !== 'mcp' && typeof body.uid === 'string' && body.uid) return { uid: body.uid, kind: 'session' }; } const mcp = await fetch(`${origin}/api/auth/mcp/verify`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => null); if (mcp?.ok) { const body = await mcp.json() as { uid?: unknown }; if (typeof body.uid === 'string' && body.uid) return { uid: body.uid, kind: 'mcp' }; } throw unauthorized('Session or credential revoked'); }
export async function requireOwner(req: Request): Promise<Owner> { const token = bearer(req); if (!token) throw unauthorized('Missing bearer token'); return verify(token); }
/**
 * Resolve the caller if they are signed in, without requiring it.
 *
 * A present-but-invalid credential is still an error: someone who believed they
 * were signed in should be told so rather than silently downgraded to keyless.
 * Only a complete absence of credentials means "anonymous".
 */
export async function optionalOwner(req: Request): Promise<Owner | null> { const token = bearer(req); if (!token) return null; return verify(token); }
export const ANONYMOUS: Owner = { uid: 'anon', kind: 'anon' };
