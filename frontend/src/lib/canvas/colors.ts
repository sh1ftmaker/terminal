// Stable identity hue per session key — tiles, sidebar rows, and callsigns
// share it so a session is recognizable at a glance.

const SESSION_HUES = [
  '#4fd1c5', '#f6ad55', '#b794f4', '#68d391', '#f687b3',
  '#63b3ed', '#fbd38d', '#81e6d9', '#fc8181', '#d6bcfa',
];

export function sessionColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return SESSION_HUES[Math.abs(h) % SESSION_HUES.length];
}

// Same meaning as everywhere else in the app (lib/sessions.ts): the accent
// marks the session that is waiting for the user. Fixed values rather than
// theme tokens, because tile screens stay dark in both canvas themes.
export const STATUS_COLORS: Record<string, string> = {
  working: '#60a5fa',
  background: '#60a5fa',
  waiting: '#4fd1c5',
  finished: '#4ade80',
  idle: '#7a879c',
};
