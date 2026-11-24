// Theme resolution: turns the saved preference + the OS setting into the
// data-theme attribute the stylesheet keys off, keeps the browser chrome
// (theme-color) in step, and provides the matching xterm palettes.

import { useSyncExternalStore } from 'react';
import type { ITheme } from '@xterm/xterm';
import { getSettings, subscribeSettings } from './settings';

export type ResolvedTheme = 'light' | 'dark';

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;

const CHROME: Record<ResolvedTheme, string> = { dark: '#1a1a2e', light: '#f1f5f9' };

export function resolveTheme(): ResolvedTheme {
  const pref = getSettings().theme;
  if (pref === 'light' || pref === 'dark') return pref;
  return media?.matches ? 'light' : 'dark';
}

/** Palette the terminal itself uses (it may stay dark inside the light theme). */
export function resolveTerminalTheme(): ResolvedTheme {
  return getSettings().darkTerminal ? 'dark' : resolveTheme();
}

const listeners = new Set<() => void>();
let snapshot = '';

function apply(): void {
  const theme = resolveTheme();
  const term = resolveTerminalTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (term !== theme) root.dataset.term = term;
  else delete root.dataset.term;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme]);
  const next = `${theme}/${term}`;
  if (next !== snapshot) {
    snapshot = next;
    listeners.forEach((fn) => fn());
  }
}

let started = false;
export function initTheme(): void {
  if (started) return;
  started = true;
  apply();
  subscribeSettings(apply);
  media?.addEventListener?.('change', apply);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** "<app theme>/<terminal theme>", e.g. "light/dark". Re-renders on change. */
export function useThemeKey(): string {
  return useSyncExternalStore(subscribe, () => snapshot || `${resolveTheme()}/${resolveTerminalTheme()}`);
}

// --- Terminal palettes -----------------------------------------------------
// Dark is the original app's palette (navy, slate, cyan). Light is a slate
// version tuned for paper; the minimum-contrast floor below covers the rest.

const DARK: ITheme = {
  background: '#1a1a2e',
  foreground: '#e2e8f0',
  cursor: '#4fd1c5',
  cursorAccent: '#1a1a2e',
  selectionBackground: 'rgba(79, 209, 197, 0.4)',
  selectionInactiveBackground: 'rgba(79, 209, 197, 0.22)',
  selectionForeground: '#ffffff',
  black: '#3f3f46',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#4fd1c5',
  white: '#e2e8f0',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#5eead4',
  brightWhite: '#f8fafc',
};

const LIGHT: ITheme = {
  background: '#f8fafc',
  foreground: '#0f172a',
  cursor: '#0f766e',
  cursorAccent: '#f8fafc',
  selectionBackground: 'rgba(15, 118, 110, 0.22)',
  selectionInactiveBackground: 'rgba(15, 118, 110, 0.14)',
  black: '#0f172a',
  red: '#b5362a',
  green: '#2b7a36',
  yellow: '#8f6200',
  blue: '#1b62a6',
  magenta: '#7a45b5',
  cyan: '#0e7490',
  white: '#64748b',
  brightBlack: '#64748b',
  brightRed: '#c13f2f',
  brightGreen: '#2f8239',
  brightYellow: '#996a00',
  brightBlue: '#2270ba',
  brightMagenta: '#8850c8',
  brightCyan: '#0e7490',
  brightWhite: '#334155',
};

export function terminalTheme(mode: ResolvedTheme = resolveTerminalTheme()): ITheme {
  return mode === 'light' ? LIGHT : DARK;
}

/**
 * Floor for text contrast; xterm adjusts any foreground that falls below it.
 * Programs pick colours assuming a dark terminal (white text, pale greys), so
 * on paper the floor is the full reading threshold. On dark it only rescues
 * the near-invisible cases, such as ANSI black on the background.
 */
export function terminalMinContrast(mode: ResolvedTheme = resolveTerminalTheme()): number {
  return mode === 'light' ? 4.5 : 3;
}
