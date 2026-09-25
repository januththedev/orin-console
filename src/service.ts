import type { Sandbox } from '@vercel/sandbox';
import { badRequest, forbidden, gone } from './errors.js';
import {
  appendEvent,
  deleteSession,
  deleteShare,
  getEnvPayload,
  getSession,
  getShare,
  insertSession,
  insertShare,
  listSessions,
  setEnvPayload,
  setSandboxName,
  touchSession,
} from './store.js';
import { attachSandbox, captureScreen, createSandbox, currentDir, destroySandbox, lastExit, portDomain, sendInput, sendKey, shellAlive, spawnShell, resize } from './sandbox.js';
import { decryptEnv, encryptEnv, maskSecrets, randomToken, sha256 } from './secrets.js';
import { SESSION_TTL_MS, type ConsoleSession, type Owner, type ShareMode } from './types.js';

export const sandboxName = (id: string) => `orin-console-${id}-${randomToken('', 4)}`;

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CreateOpts {
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  ports?: number[];
}

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : dflt;
  return Math.min(hi, Math.max(lo, v));
}

function validateCreate(o: CreateOpts): { cols: number; rows: number; env: Record<string, string>; ports: number[] } {
  const cols = clamp(o.cols, 40, 250, 100);
  const rows = clamp(o.rows, 10, 80, 30);
  const env: Record<string, string> = {};
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env)) throw badRequest('env must be an object');
    const names = Object.keys(o.env);
    if (names.length > 20) throw badRequest('max 20 env vars');
    for (const k of names) {
      if (!ENV_NAME_RE.test(k) || k.length > 64) throw badRequest(`bad env name: ${k}`);
      const v = o.env[k];
      if (typeof v !== 'string' || v.length > 8192) throw badRequest(`bad env value: ${k}`);
      env[k] = v;
    }
  }
  let ports: number[] = [];
  if (o.ports !== undefined) {
    if (!Array.isArray(o.ports)) throw badRequest('ports must be an array');
    ports = [...new Set(o.ports)];
    if (ports.length > 8) throw badRequest('max 8 ports');
    for (const p of ports) {
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw badRequest(`bad port: ${p}`);
    }
  }
  return { cols, rows, env, ports };
}

export async function createSession(owner: Owner, opts: CreateOpts): Promise<ConsoleSession> {
  const { cols, rows, env, ports } = validateCreate(opts);
  const id = randomToken('cns_', 12);
  const name = sandboxName(id);
  const sb = await createSandbox(name, env, ports);
  try {
    await spawnShell(sb, cols, rows);
  } catch (e) {
    await destroySandbox(sb);
    throw e;
  }
  const now = Date.now();
  const session = await insertSession({
    id,
    ownerUid: owner.uid,
    sandboxId: name,
    cwd: '~',
    cols,
    rows,
    ports,
    expiresAt: new Date(now + SESSION_TTL_MS),
  });
  if (Object.keys(env).length) {
    await setEnvPayload(id, encryptEnv(env));
    const { setEnvNames } = await import('./store.js');
    await setEnvNames(id, Object.keys(env));
  }
  await appendEvent(id, 'system', { msg: 'session created', cols, rows, ports });
  session.portUrls = publicUrls(sb, session.ports);
  return session;
}

function publicUrls(sb: Sandbox, ports: number[]): string[] {
  return ports.map((port) => { try { return portDomain(sb, port); } catch { return ''; } }).filter(Boolean);
}

export interface Live {
  session: ConsoleSession;
  sb: Sandbox;
}

/**
 * Load + TTL-enforce + reattach. Expired sessions are destroyed (410).
 * A vanished sandbox inside a live session is transparently renewed with a
 * fresh one (history + shares survive; filesystem does not).
 */
export async function getLive(id: string, ownerUid?: string): Promise<Live> {
  const session = await getSession(id);
  if (!session) throw gone('Session not found');
  if (ownerUid && session.ownerUid !== ownerUid) throw forbidden('Not your session');
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await destroySession(id);
    throw gone();
  }
  let sb = await attachSandbox(session.sandboxId);
  if (!sb) {
    sb = await renewSandbox(session);
  } else if (!(await shellAlive(sb))) {
    await spawnShell(sb, session.cols, session.rows);
    await appendEvent(id, 'system', { msg: 'shell respawned after sandbox reboot' });
  }
  session.portUrls = publicUrls(sb, session.ports);
  return { session, sb };
}

/** Provision a fresh sandbox for a live session (compute slice renewal). */
async function renewSandbox(session: ConsoleSession): Promise<Sandbox> {
  const name = sandboxName(session.id);
  const env = await currentEnv(session.id);
  const sb = await createSandbox(name, env, session.ports);
  try {
    await spawnShell(sb, session.cols, session.rows);
  } catch (e) {
    await destroySandbox(sb);
    throw e;
  }
  await setSandboxName(session.id, name);
  await appendEvent(session.id, 'system', { msg: 'sandbox renewed (fresh filesystem, history kept)' });
  return sb;
}

async function currentEnv(sessionId: string): Promise<Record<string, string>> {
  try {
    const blob = await getEnvPayload(sessionId);
    return blob ? decryptEnv(blob) : {};
  } catch {
    throw new Error('stored console environment could not be decrypted');
  }
}

export async function destroySession(id: string): Promise<void> {
  const s = await getSession(id);
  if (s) {
    const sb = await attachSandbox(s.sandboxId);
    if (sb) await destroySandbox(sb);
  }
  await deleteSession(id);
}

export async function listMine(owner: Owner): Promise<ConsoleSession[]> {
  const all = await listSessions(owner.uid);
  const now = Date.now();
  const live: ConsoleSession[] = [];
  for (const s of all) {
    if (new Date(s.expiresAt).getTime() <= now) {
      await destroySession(s.id).catch(() => {});
    } else {
      live.push(s);
    }
  }
  return live;
}

async function secretValues(sessionId: string): Promise<string[]> {
  try {
    const blob = await getEnvPayload(sessionId);
    if (!blob) return [];
    return Object.values(decryptEnv(blob));
  } catch {
    throw new Error('stored console secrets could not be decrypted');
  }
}

const queues = new Map<string, Promise<unknown>>();
function serial<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(id, next);
  return next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
}

export function pushText(live: Live, text: string): Promise<void> {
  if (typeof text !== 'string' || !text || text.length > 4096) return Promise.reject(badRequest('text 1..4096 chars'));
  return serial(live.session.id, async () => {
    await sendInput(live.sb, text);
    const secrets = await secretValues(live.session.id);
    await appendEvent(live.session.id, 'command', { text: maskSecrets(text, secrets) });
    await touchSession(live.session.id);
  });
}

export function pushKey(live: Live, key: string): Promise<void> {
  return serial(live.session.id, async () => {
    if (key === 'Enter') await sendKey(live.sb, 'Enter');
    else if (['C-c', 'C-d', 'C-z', 'C-l'].includes(key)) { await sendKey(live.sb, key); await appendEvent(live.session.id, 'signal', { key }); }
    else if (['Tab', 'Up', 'Down', 'Left', 'Right', 'Escape', 'BSpace', 'DC'].includes(key)) await sendKey(live.sb, key);
    else throw badRequest('unsupported key');
    await touchSession(live.session.id);
  });
}

export interface PollResult {
  screen: string;
  cwd: string;
  changed: boolean;
}

export async function pollScreen(live: Live, lastScreen: string): Promise<PollResult> {
  const { id } = live.session;
  const raw = await captureScreen(live.sb);
  const secrets = await secretValues(id);
  const text = maskSecrets(raw, secrets);
  // Exit codes: pane-title hook; fire only on change (first sighting sets baseline silently).
  const code = await lastExit(live.sb);
  if (code !== null && live.session.lastExit !== null && code !== live.session.lastExit) {
    await appendEvent(id, 'exit', { code });
  }
  if (code !== null && code !== live.session.lastExit) {
    await touchSession(id, { lastExit: code });
  }
  const cwd = maskSecrets(await currentDir(live.sb), secrets);
  if (cwd !== live.session.cwd) {
    await touchSession(id, { cwd });
    await appendEvent(id, 'system', { msg: 'cwd', cwd });
  }
  const changed = text !== lastScreen;
  if (changed) {
    const prev = lastScreen.split('\n');
    const next = text.split('\n');
    let i = 0;
    while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
    const delta = next.slice(i).join('\n').slice(0, 8000);
    if (delta.trim()) await appendEvent(id, 'stdout', { text: delta });
    await touchSession(id);
  }
  return { screen: text, cwd, changed };
}

export function doResize(live: Live, cols: number, rows: number): Promise<void> {
  return serial(live.session.id, async () => {
    const c = clamp(cols, 40, 250, live.session.cols);
    const r = clamp(rows, 10, 80, live.session.rows);
    await resize(live.sb, c, r);
    await touchSession(live.session.id, { cols: c, rows: r });
    await appendEvent(live.session.id, 'resize', { cols: c, rows: r });
  });
}

export async function createShare(owner: Owner, sessionId: string, mode: string): Promise<{ token: string; mode: ShareMode }> {
  if (mode !== 'read' && mode !== 'terminal') throw badRequest('mode must be read|terminal');
  const live = await getLive(sessionId, owner.uid);
  if (mode === 'terminal' && live.session.envNames.length) throw badRequest('Terminal sharing is disabled for sessions with injected environment values.');
  const token = randomToken('cst_', 32);
  await insertShare(sha256(token), live.session.id, mode);
  await appendEvent(live.session.id, 'system', { msg: 'share created', mode });
  return { token, mode };
}

export async function revokeShare(owner: Owner, sessionId: string, token: string): Promise<void> {
  await getLive(sessionId, owner.uid);
  const ok = await deleteShare(sha256(token), sessionId);
  if (!ok) throw badRequest('unknown share token');
  await appendEvent(sessionId, 'system', { msg: 'share revoked' });
}

/** Guest access via share link. Token hash lookup; TTL enforced like owner. */
export async function resolveShare(token: string): Promise<{ live: Live; mode: ShareMode }> {
  if (!token.startsWith('cst_')) throw badRequest('bad share token');
  const sh = await getShare(sha256(token));
  if (!sh) throw gone('Share not found');
  const live = await getLive(sh.sessionId);
  return { live, mode: sh.mode as ShareMode };
}
