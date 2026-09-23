import { handle, json } from '../_lib.js';
import { requireOwner } from '../../src/auth.js';
import { destroySession, getLive } from '../../src/service.js';
import { listEvents } from '../../src/store.js';

export default handle(async (req: Request) => {
  const owner = await requireOwner(req);
  const id = new URL(req.url).pathname.split('/').pop() as string;
  if (req.method === 'GET') {
    const { session } = await getLive(id, owner.uid);
    return json({ session, history: await listEvents(id, 0, 200) });
  }
  if (req.method === 'DELETE') {
    await getLive(id, owner.uid);
    await destroySession(id);
    return json({ deleted: true });
  }
  return json({ error: 'Method not allowed' }, 405);
});
