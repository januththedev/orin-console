import { handle, json, readJson } from '../_lib.js';
import { ANONYMOUS, optionalOwner, requireOwner } from '../../src/auth.js';
import { badRequest, tooMany } from '../../src/errors.js';
import { createSession, listMine } from '../../src/service.js';
import { countActiveSessions } from '../../src/store.js';
import { clientIdFrom, consumeAnonymousCreation } from '../../src/ratelimit.js';

const MAX_ACTIVE_SESSIONS = () => Number(process.env.ORIN_CONSOLE_MAX_ACTIVE_SESSIONS ?? 50);

export default handle(async (req: Request) => {
  if (req.method === 'GET') {
    // Listing is account-only. A keyless visitor holds one link, not an index.
    return json({ sessions: await listMine(await requireOwner(req)) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const owner = (await optionalOwner(req)) ?? ANONYMOUS;
  const body = await readJson(req);

  if (owner.kind === 'anon') {
    // No login is the point, so anonymous creation is allowed — but the
    // per-client window and the global live-session cap are what keep that
    // from being unlimited sandbox spend.
    const limit = consumeAnonymousCreation(clientIdFrom(req));
    if (!limit.allowed) throw tooMany('Keyless session limit reached. Try again later.', limit.retryAfterSeconds);
    if (await countActiveSessions() >= MAX_ACTIVE_SESSIONS()) {
      throw tooMany('Orin Console is at capacity. Try again shortly.', 120);
    }
    if (body.env !== undefined) throw badRequest('Environment variables require a signed-in session.');
  }

  const session = await createSession(owner, {
    cols: body.cols as number | undefined,
    rows: body.rows as number | undefined,
    env: owner.kind === 'anon' ? undefined : (body.env as Record<string, string> | undefined),
    ports: body.ports as number[] | undefined,
  });
  return json({ session, anonymous: owner.kind === 'anon' }, 201);
});
