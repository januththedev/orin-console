import { timingSafeEqual } from 'node:crypto';
import { deleteExpiredSessions } from '../../src/store.js';
export const config = { maxDuration: 30 };
function authorized(req: Request): boolean { const expected = process.env.CRON_SECRET || ''; const header = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); if (expected.length < 32 || header.length !== expected.length) return false; return timingSafeEqual(Buffer.from(header), Buffer.from(expected)); }
export default async function handler(req: Request): Promise<Response> { if (req.method !== 'POST' || !authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 }); const count = await deleteExpiredSessions(); return Response.json({ deleted: count }); }
