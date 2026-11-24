// Shared session vocabulary for the home screen and the terminal header.

export type SessionStatus = 'working' | 'background' | 'waiting' | 'finished' | 'idle';

/** A subagent or background shell still running after Claude's turn ended. */
export interface BackgroundTask {
  type: string;
  description?: string;
}

export interface SessionMeta {
  status?: SessionStatus;
  task?: string;
  cwd?: string;
  preview_url?: string;
  claude_session_id?: string;
  updated_at?: number;
  background?: BackgroundTask[];
}

export interface Session {
  name: string;
  context?: string;
  created: string;
  lastAccess: string;
  meta?: SessionMeta;
}

export interface ContextInfo {
  name: string;
  label: string;
  user: string | null;
}

/** Colour token (a CSS custom property) and wording per agent status. */
export const STATUS: Record<SessionStatus, { label: string; tone: string }> = {
  // "Waiting" is the one that needs the user, so it gets the accent.
  working: { label: 'Working', tone: 'var(--info)' },
  // Turn ended but subagents / background shells are still running: busy, not
  // waiting on the user, so it shares Working's tone rather than the accent.
  background: { label: 'Background', tone: 'var(--info)' },
  waiting: { label: 'Waiting for you', tone: 'var(--accent)' },
  finished: { label: 'Finished', tone: 'var(--ok)' },
  idle: { label: 'Idle', tone: 'var(--ink-3)' },
};

/** "2 agents, 1 shell" for the running background tasks, or '' when none. */
export function backgroundSummary(meta?: SessionMeta): string {
  const tasks = Array.isArray(meta?.background) ? meta.background : [];
  if (!tasks.length) return '';
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const kind = t?.type === 'subagent' ? 'agent' : t?.type === 'shell' ? 'shell' : 'task';
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ');
}

/** One line per running background task, for tooltips. */
export function backgroundDetail(meta?: SessionMeta): string {
  const tasks = Array.isArray(meta?.background) ? meta.background : [];
  return tasks.map((t) => `${t.type === 'subagent' ? 'Agent' : t.type === 'shell' ? 'Shell' : 'Task'}: ${t.description || '…'}`).join('\n');
}

/** Status wording with background work folded in: "Waiting on 2 agents",
 *  "Working · 1 shell in background". */
export function statusLabel(meta: SessionMeta | undefined, status: SessionStatus): string {
  const bg = backgroundSummary(meta);
  if (status === 'background') return bg ? `Waiting on ${bg}` : STATUS.background.label;
  if (status === 'working' && bg) return `${STATUS.working.label} · ${bg} in background`;
  return STATUS[status].label;
}

export function statusOf(meta?: SessionMeta): SessionStatus | null {
  return meta?.status && STATUS[meta.status] ? meta.status : null;
}

// Per-context colours: stable by name. The usual role names keep a fixed
// tone (the same families the app has always used for them); anything else
// hashes onto the palette.
const CONTEXT_TONES: Record<string, string> = {
  admin: 'var(--ink-2)',
  work: 'var(--warn)',
  john: 'var(--teal)',
  untrusted: 'var(--danger)',
  tom: 'var(--violet)',
};
const TONE_CYCLE = ['var(--info)', 'var(--violet)', 'var(--teal)', 'var(--ok)', 'var(--warn)'];

export function contextTone(name: string | null | undefined): string {
  if (!name) return 'var(--ink-3)';
  if (CONTEXT_TONES[name]) return CONTEXT_TONES[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TONE_CYCLE[Math.abs(h) % TONE_CYCLE.length];
}

/** "now", "5m", "3h", "2d" — compact enough for a list's trailing column. */
export function shortAgo(date: string | number): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.floor(ms / 60000);
  if (!Number.isFinite(m) || m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}

/** Tmux session names: the server strips everything else. */
export function sanitizeSessionName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 50);
}
