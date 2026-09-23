import { handle, json } from '../_lib.js';
import { resolveShare } from '../../src/service.js';
import { listEvents } from '../../src/store.js';

/** Guest bootstrap: share mode, TTL, and replayable history. No secrets ever. */
export default handle(async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const token = new URL(req.url).pathname.split('/').pop() as string;
  const { live, mode } = await resolveShare(token);
  return json({
    mode,
    expiresAt: live.session.expiresAt,
    cwd: live.session.cwd,
    history: await listEvents(live.session.id, 0, 200),
  });
});
