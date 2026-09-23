import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { TOKEN_KEY } from './config.js';

/** AES-256-GCM envelope for per-session env payloads. Key = Orin signing key (documented). */
function key(): Buffer {
  return createHash('sha256').update('orin-console-env:' + TOKEN_KEY()).digest();
}

export function encryptEnv(payload: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptEnv(blob: string): Record<string, string> {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  const out = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
  if (!out || typeof out !== 'object') throw new Error('bad payload');
  return out as Record<string, string>;
}

/** Replace known secret VALUES in captured text before storing/logging. */
export function maskSecrets(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (v && v.length >= 4 && out.includes(v)) out = out.split(v).join('***');
  }
  return out;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function randomToken(prefix: string, bytes = 32): string {
  return prefix + randomBytes(bytes).toString('hex');
}
