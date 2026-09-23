import { handle, json, readJson } from '../../_lib.js';
import { requireOwner } from '../../../src/auth.js';
import { doResize, getLive, pushKey, pushText } from '../../../src/service.js';
import { badRequest } from '../../../src/errors.js';

/**
 * POST { text } — literal keystrokes | { key } — Enter|C-c|C-d|C-z|arrows|Tab…
 * | { cols, rows } — resize. The shell interprets everything; we never parse.
 */
export default handle(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const owner = await requireOwner(req);
  const parts = new URL(req.url).pathname.split('/');
  const id = parts[parts.length - 2];
  const live = await getLive(id, owner.uid);
  const body = await readJson(req);
  if (typeof body.text === 'string') {
    await pushText(live, body.text);
    return json({ ok: true });
  }
  if (typeof body.key === 'string') {
    await pushKey(live, body.key);
    return json({ ok: true });
  }
  if (body.cols !== undefined || body.rows !== undefined) {
    await doResize(live, body.cols as number, body.rows as number);
    return json({ ok: true });
  }
  throw badRequest('provide text, key, or cols/rows');
});
