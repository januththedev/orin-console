import { handle, json, readJson } from '../_lib.js';
import { requireOwner } from '../../src/auth.js';
import { createSession, listMine } from '../../src/service.js';

export default handle(async (req: Request) => {
  const owner = await requireOwner(req);
  if (req.method === 'POST') {
    const body = await readJson(req);
    const s = await createSession(owner, {
      cols: body.cols as number | undefined,
      rows: body.rows as number | undefined,
      env: body.env as Record<string, string> | undefined,
      ports: body.ports as number[] | undefined,
    });
    return json({ session: s }, 201);
  }
  if (req.method === 'GET') {
    return json({ sessions: await listMine(owner) });
  }
  return json({ error: 'Method not allowed' }, 405);
});
