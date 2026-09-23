import { handle, readJson } from '../../_lib.js';
import { requireOwner } from '../../../src/auth.js';
import { getLive, pollScreen } from '../../../src/service.js';
import { listEvents } from '../../../src/store.js';
import { POLL_MS } from '../../../src/types.js';

const enc = new TextEncoder();
const WINDOW_MS = 50000;

/**
 * POST { lastScreen, since } -> text/event-stream for ~50s.
 * Emits full-screen frames only on change + new history events + heartbeats.
 * Client reconnects with the latest frame (stateless functions).
 */
export default handle(async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const owner = await requireOwner(req);
  const parts = new URL(req.url).pathname.split('/');
  const id = parts[parts.length - 2];
  const live = await getLive(id, owner.uid);
  const body = await readJson(req);
  let last = typeof body.lastScreen === 'string' ? (body.lastScreen as string).slice(0, 60000) : '';
  let since = typeof body.since === 'number' ? body.since : 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const t0 = Date.now();
      let lastBeat = 0;
      try {
        while (Date.now() - t0 < WINDOW_MS) {
          let r;
          try {
            r = await pollScreen(live, last);
          } catch {
            send({ dead: true });
            break;
          }
          const events = await listEvents(id, since, 100).catch(() => []);
          if (events.length) since = events[events.length - 1].id;
          if (r.changed || events.length) {
            last = r.screen;
            send({ screen: r.screen, cwd: r.cwd, events, since });
          } else if (Date.now() - lastBeat > 12000) {
            lastBeat = Date.now();
            controller.enqueue(enc.encode(':ping\n\n'));
          }
          await new Promise((res) => setTimeout(res, POLL_MS));
        }
        send({ reconnect: true });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
});
