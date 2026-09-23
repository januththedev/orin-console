import { resolveShare, pollScreen } from '../../../src/service.js';
import { listEvents } from '../../../src/store.js';
import { POLL_MS } from '../../../src/types.js';
import { readJson } from '../../_lib.js';

const enc = new TextEncoder();
const WINDOW_MS = 50000;

/** Guest stream (both modes). Same frame protocol as the owner stream. */
export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const parts = new URL(req.url).pathname.split('/');
    const token = parts[parts.length - 2];
    const { live } = await resolveShare(token);
    const id = live.session.id;
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
  } catch {
    return Response.json({ error: 'Share not found or expired' }, { status: 410 });
  }
}
