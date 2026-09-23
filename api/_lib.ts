import { toResponse } from '../src/errors.js';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type Handler = (req: Request) => Promise<Response>;

/** Maps HttpError -> status+{error}; never leaks internals. */
export function handle(fn: Handler): Handler {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      const { status, body } = toResponse(e);
      return json(body, status);
    }
  };
}
