export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (m = 'Bad request') => new HttpError(400, 'bad_request', m);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, 'unauthorized', m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const gone = (m = 'Session expired and was destroyed') => new HttpError(410, 'expired', m);
export const conflict = (m = 'Conflict') => new HttpError(409, 'conflict', m);
export const upstream = (m = 'Sandbox error') => new HttpError(502, 'sandbox_error', m);
export const internal = (m = 'Internal error') => new HttpError(500, 'internal', m);

/** Never leak stack traces or internals to clients. */
export function toResponse(e: unknown): { status: number; body: Record<string, string> } {
  if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
  console.error('[orin-console]', e instanceof Error ? e.message : 'unknown');
  return { status: 500, body: { error: 'Internal error' } };
}
