// Per-device preferences, persisted in localStorage and shared with React
// through useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { store } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  /** App theme. "system" follows the OS. */
  theme: ThemePref;
  /** Terminal font size in CSS px. Smaller = more columns. */
  fontSize: number;
  /** Keep the terminal on the dark palette even in the light theme. */
  darkTerminal: boolean;
  /** Vibrate briefly on key-bar presses (where the platform supports it). */
  haptics: boolean;
}

export const FONT_MIN = 10;
export const FONT_MAX = 20;

const KEY = 'terminal.settings';

function defaults(): Settings {
  // Phones get a slightly smaller face: 13px fits ~47 columns in portrait.
  const phone = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 500;
  return { theme: 'system', fontSize: phone ? 13 : 14, darkTerminal: false, haptics: true };
}

function load(): Settings {
  const base = defaults();
  try {
    const raw = JSON.parse(store.get(KEY) || '{}') as Partial<Settings>;
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      fontSize: typeof raw.fontSize === 'number' ? clampFont(raw.fontSize) : base.fontSize,
      darkTerminal: raw.darkTerminal === true,
      haptics: raw.haptics !== false,
    };
  } catch {
    return base;
  }
}

function clampFont(n: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  const next = { ...current, ...patch };
  next.fontSize = clampFont(next.fontSize);
  current = next;
  store.set(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

// Another tab changed the settings: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== store.key(KEY)) return;
    current = load();
    listeners.forEach((fn) => fn());
  });
}
