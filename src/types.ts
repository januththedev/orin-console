export type ShareMode = 'read' | 'terminal';
export type EventType = 'command' | 'stdout' | 'resize' | 'signal' | 'exit' | 'system' | 'env';

export interface ConsoleSession {
  id: string;
  ownerUid: string;
  sandboxId: string;
  cwd: string;
  cols: number;
  rows: number;
  envNames: string[];
  lastExit: number | null;
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
}

export interface HistoryEvent {
  id: number;
  at: string;
  type: EventType;
  data: Record<string, unknown>;
}

export interface Owner {
  uid: string;
  /** 'session' (Orin login) or 'mcp' (credential token) */
  kind: 'session' | 'mcp';
}

/** Session TTL: 24h from creation. Enforced server-side on every access. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Cap stored events per session so replay stays cheap. */
export const MAX_EVENTS_PER_SESSION = 400;
/** Screen poll interval inside a stream request (ms). */
export const POLL_MS = 350;
/** Max lines captured from the tmux pane per poll. */
export const CAPTURE_LINES = 200;
