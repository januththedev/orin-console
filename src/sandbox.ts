import { Sandbox } from '@vercel/sandbox';
import { upstream } from './errors.js';
import { CAPTURE_LINES } from './types.js';

/**
 * Hobby plans cap sandbox `timeout` at 45 minutes (platform-enforced).
 * Compute slices therefore live <= 40m; the SESSION record (history, shares)
 * still lives 24h and a fresh sandbox is transparently provisioned on access.
 */
export const SANDBOX_TTL_MS = 40 * 60 * 1000;

const TMUX = 'console';

/**
 * Bash hook installed at spawn: after every command, tmux's native
 * OSC 0/2 handling stores the exit status in the pane title, which we poll
 * with display-message. Real exit codes, zero shell emulation, and nothing
 * leaks into the visible screen.
 */
const EXIT_HOOK =
  `__orin_ec(){ printf '\\e]0;EC:%s\\a' "$?"; }; PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }__orin_ec"`;
const TITLE_RE = /^EC:(\d+)$/;

async function exec(sb: Sandbox, ...args: string[]): Promise<string> {
  try {
    const r = await sb.runCommand(args[0], args.slice(1), { timeoutMs: 15000 });
    return (await r.stdout()).trim();
  } catch (e) {
    throw upstream(`tmux ${args[0]} failed: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`);
  }
}

/** One isolated sandbox per compute slice. Platform kills it at TTL even if we miss cleanup. */
export async function createSandbox(name: string, env: Record<string, string>, ports: number[]): Promise<Sandbox> {
  try {
    const params: Parameters<typeof Sandbox.create>[0] = {
      name,
      timeout: SANDBOX_TTL_MS,
      ...(ports.length ? { ports } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      tags: { app: 'orin-console' },
    };
    return await Sandbox.create(params);
  } catch (e) {
    throw upstream(`sandbox create failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`);
  }
}

/** Reattach to a live sandbox by name. Null when gone (expired/stopped). */
export async function attachSandbox(name: string): Promise<Sandbox | null> {
  try {
    return await Sandbox.get({ name });
  } catch {
    return null;
  }
}

export async function destroySandbox(sb: Sandbox): Promise<void> {
  try {
    await sb.stop();
  } catch {
    /* already gone */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spawn the tmux PTY inside the sandbox and install the exit-code hook. */
export async function spawnShell(sb: Sandbox, cols: number, rows: number): Promise<void> {
  await exec(sb, 'tmux', 'kill-session', '-t', TMUX).catch(() => {});
  try {
    await exec(sb, 'tmux', 'new-session', '-d', '-s', TMUX, '-x', String(cols), '-y', String(rows), 'bash');
  } catch {
    await exec(sb, 'tmux', 'new-session', '-d', '-s', TMUX, '-x', String(cols), '-y', String(rows));
  }
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, '-l', '--', EXIT_HOOK);
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, 'Enter');
  await sleep(900);
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, '-l', '--', 'clear');
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, 'Enter');
  await sleep(300);
}

/** Literal keystrokes — the shell (not the frontend) interprets everything. */
export async function sendInput(sb: Sandbox, text: string): Promise<void> {
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, '-l', '--', text);
}
/** Named keys: Enter, C-c, C-d, C-l (clear), C-z, Tab, arrows, Escape, BS, DC. */
const KEYS = new Set(['Enter', 'C-c', 'C-d', 'C-l', 'C-z', 'Tab', 'Up', 'Down', 'Left', 'Right', 'Escape',
  'BSpace', 'DC']);
export async function sendKey(sb: Sandbox, key: string): Promise<void> {
  if (!KEYS.has(key)) throw new Error('unsupported key');
  await exec(sb, 'tmux', 'send-keys', '-t', TMUX, key);
}

export async function captureScreen(sb: Sandbox): Promise<string> {
  return exec(sb, 'tmux', 'capture-pane', '-p', '-t', TMUX, '-S', `-${CAPTURE_LINES}`);
}

/** Last command exit status via the pane title hook. Null when unavailable (non-bash). */
export async function lastExit(sb: Sandbox): Promise<number | null> {
  try {
    const title = await exec(sb, 'tmux', 'display-message', '-p', '-t', TMUX, '#{pane_title}');
    const m = TITLE_RE.exec(title.trim());
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export async function currentDir(sb: Sandbox): Promise<string> {
  try {
    const d = await exec(sb, 'tmux', 'display-message', '-p', '-t', TMUX, '#{pane_current_path}');
    return d.replace(/^\/home\/[^/]+/, '~');
  } catch {
    return '~';
  }
}

export async function resize(sb: Sandbox, cols: number, rows: number): Promise<void> {
  await exec(sb, 'tmux', 'resize-window', '-t', TMUX, '-x', String(cols), '-y', String(rows));
}

export async function shellAlive(sb: Sandbox): Promise<boolean> {
  try {
    await exec(sb, 'tmux', 'has-session', '-t', TMUX);
    return true;
  } catch {
    return false;
  }
}

/** Public URL for an exposed port (port must be declared at create). */
export function portDomain(sb: Sandbox, port: number): string {
  return sb.domain(port);
}
