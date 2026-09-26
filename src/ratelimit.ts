/**
 * Abuse control for keyless session creation.
 *
 * Orin Console is meant to be usable without an account, which means anyone on
 * the internet can ask for a sandbox. Two independent controls bound that:
 *
 *  1. A per-client fixed window below, which is per-instance and therefore only
 *     a fast first line. It smooths out bursts but is not a global limit.
 *  2. `ORIN_CONSOLE_MAX_ACTIVE_SESSIONS`, enforced in the database by
 *     `countActiveSessions()`. That one is global and is the real ceiling, so
 *     scaling out horizontally does not multiply the cost.
 *
 * The in-memory window is deliberately not presented as sufficient on its own.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Cap the map so a spray of distinct keys cannot grow it without bound. */
const MAX_TRACKED_CLIENTS = 10_000;

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consumeAnonymousCreation(
  clientId: string,
  limit = Number(process.env.ORIN_CONSOLE_ANON_PER_HOUR ?? 5),
  windowMs = 60 * 60 * 1000,
  now = Date.now(),
): LimitResult {
  const key = clientId.slice(0, 128);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_CLIENTS) {
      // Drop the oldest window rather than refusing service.
      let oldestKey = '';
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [candidate, value] of windows) {
        if (value.resetAt < oldestAt) { oldestAt = value.resetAt; oldestKey = candidate; }
      }
      if (oldestKey) windows.delete(oldestKey);
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - existing.count), retryAfterSeconds: 0 };
}

/** Test-only reset so the limiter does not leak state between cases. */
export function resetLimiter(): void { windows.clear(); }

/**
 * Best-effort client identity for rate limiting. Proxy headers are only
 * trusted when the deployment is behind a proxy that sets them; a forged value
 * is a nuisance, not a security boundary, because the database-level cap is the
 * control that actually matters.
 */
export function clientIdFrom(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || 'unknown';
}
