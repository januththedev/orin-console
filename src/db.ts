import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { DATABASE_URL } from './config.js';

let client: NeonQueryFunction<false, false> | null = null;

function get(): NeonQueryFunction<false, false> {
  if (!client) client = neon(DATABASE_URL());
  return client;
}

/**
 * Neon HTTP client (serverless-safe, pooled). Tag usage: sql`SELECT ...`.
 * Throws if DATABASE_URL is missing.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> {
  const q = get() as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>;
  return q(strings, ...values);
}
