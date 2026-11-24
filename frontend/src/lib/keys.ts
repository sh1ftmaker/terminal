// Key-bar vocabulary: what each on-screen key sends, and how the sticky
// Ctrl / Alt modifiers change it. Everything goes through tmux, which accepts
// the xterm encodings used here regardless of the inner app's cursor-key mode.

export type ModName = 'ctrl' | 'alt';
export type ModState = 'off' | 'armed' | 'locked';
export type Mods = Record<ModName, ModState>;

export const NO_MODS: Mods = { ctrl: 'off', alt: 'off' };

export type KeyId = 'esc' | 'tab' | 'backtab' | 'enter' | 'up' | 'down' | 'left' | 'right' | 'slash' | 'dash' | 'pipe' | 'tilde' | 'interrupt' | 'prefix';

const ARROWS: Partial<Record<KeyId, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' };
const CHARS: Partial<Record<KeyId, string>> = { slash: '/', dash: '-', pipe: '|', tilde: '~' };

/** Keys that auto-repeat while held. */
export const REPEATS: ReadonlySet<KeyId> = new Set<KeyId>(['up', 'down', 'left', 'right']);

/** Ctrl + a printable character, as a terminal would send it. */
export function ctrlChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60);   // a-z
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code - 0x40);   // @ A-Z [ \ ] ^ _
  switch (ch) {
    case ' ': case '2': return '\x00';
    case '3': return '\x1b';
    case '4': case '|': return '\x1c';
    case '5': return '\x1d';
    case '6': return '\x1e';
    case '7': case '/': case '-': return '\x1f';
    case '8': case '?': return '\x7f';
    default: return ch;
  }
}

/** Bytes for an on-screen key under the given modifiers. */
export function encodeKey(id: KeyId, mods: Mods): string {
  const ctrl = mods.ctrl !== 'off';
  const alt = mods.alt !== 'off';
  const arrow = ARROWS[id];
  if (arrow) {
    const m = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
    return m === 1 ? `\x1b[${arrow}` : `\x1b[1;${m}${arrow}`;
  }
  const ch = CHARS[id];
  if (ch) return applyMods(ch, mods);
  switch (id) {
    case 'esc': return '\x1b';
    case 'tab': return alt ? '\x1b\t' : '\t';
    case 'backtab': return '\x1b[Z';
    case 'enter': return ctrl ? '\n' : alt ? '\x1b\r' : '\r';
    case 'interrupt': return '\x03';
    case 'prefix': return '\x02';      // Ctrl+B, tmux's (default / secondary) prefix
    default: return '';
  }
}

/**
 * Apply sticky modifiers to text typed on the soft keyboard. Only a single
 * character is a "key press"; pastes, IME commits and escape sequences pass
 * through untouched.
 */
export function applyMods(data: string, mods: Mods): string {
  const ctrl = mods.ctrl !== 'off';
  const alt = mods.alt !== 'off';
  if (!ctrl && !alt) return data;
  if ([...data].length !== 1) return data;
  let out = data;
  if (ctrl) out = ctrlChar(out);
  if (alt) out = `\x1b${out}`;
  return out;
}

/** Modifiers after a key was sent: one-shot ("armed") ones release. */
export function releaseArmed(mods: Mods): Mods {
  if (mods.ctrl !== 'armed' && mods.alt !== 'armed') return mods;
  return {
    ctrl: mods.ctrl === 'armed' ? 'off' : mods.ctrl,
    alt: mods.alt === 'armed' ? 'off' : mods.alt,
  };
}

/**
 * Tap on a modifier key. Like the iOS shift key: a tap arms it for one key,
 * a second tap in quick succession locks it, and a tap while on releases it.
 */
export function tapModifier(state: ModState, msSinceLastTap: number): ModState {
  if (state === 'locked') return 'off';
  if (state === 'armed') return msSinceLastTap < 400 ? 'locked' : 'off';
  return 'armed';
}

export function haptic(enabled: boolean): void {
  if (!enabled) return;
  try { navigator.vibrate?.(8); } catch { /* unsupported */ }
}
