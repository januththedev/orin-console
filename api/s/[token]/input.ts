import { handle, json, readJson } from '../../_lib.js';
import { forbidden } from '../../../src/errors.js';
import { doResize, pushKey, pushText, resolveShare } from '../../../src/service.js';

/** Guest input — terminal-mode shares only. Read shares get 403. */
export default handle(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const parts = new URL(req.url).pathname.split('/');
  const token = parts[parts.length - 2];
  const { live, mode } = await resolveShare(token);
  if (mode !== 'terminal') throw forbidden('Read-only share');
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
  return json({ error: 'provide text, key, or cols/rows' }, 400);
});
