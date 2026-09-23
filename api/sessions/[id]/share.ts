import { handle, json, readJson } from '../../_lib.js';
import { requireOwner } from '../../../src/auth.js';
import { createShare, getLive, revokeShare } from '../../../src/service.js';
import { listShares } from '../../../src/store.js';
import { badRequest } from '../../../src/errors.js';

/** GET list (modes+dates, tokens never re-shown) | POST {mode} -> token (once) | DELETE {token} revoke */
export default handle(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    return json({ error: 'Method not allowed' }, 405);
  }
  const owner = await requireOwner(req);
  const parts = new URL(req.url).pathname.split('/');
  const id = parts[parts.length - 2];
  if (req.method === 'GET') {
    await getLive(id, owner.uid);
    return json({ shares: await listShares(id) });
  }
  const body = await readJson(req);
  if (req.method === 'POST') {
    if (typeof body.mode !== 'string') throw badRequest('mode required');
    const { token, mode } = await createShare(owner, id, body.mode);
    return json({ token, mode }, 201);
  }
  if (typeof body.token !== 'string') throw badRequest('token required');
  await revokeShare(owner, id, body.token);
  return json({ revoked: true });
});
