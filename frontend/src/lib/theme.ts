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

const CHROME: Record<ResolvedTheme, string> = { dark: '#141312', light: '#f5f2eb' };

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
// Tuned against their backgrounds: every colour except ANSI black clears
// 4:1 on dark and on paper.

const DARK: ITheme = {
  background: '#141312',
  foreground: '#ece7df',
  cursor: '#f5a04a',
  cursorAccent: '#141312',
  selectionBackground: 'rgba(245, 160, 74, 0.32)',
  selectionInactiveBackground: 'rgba(245, 160, 74, 0.2)',
  black: '#3a3531',
  red: '#f07a68',
  green: '#86c47c',
  yellow: '#e8b85c',
  blue: '#74b4e8',
  magenta: '#c9a0f0',
  cyan: '#6cc9c0',
  white: '#d6d0c5',
  brightBlack: '#857d72',
  brightRed: '#ff9a88',
  brightGreen: '#a6dd9a',
  brightYellow: '#f7d07e',
  brightBlue: '#9ccdf6',
  brightMagenta: '#ddbdff',
  brightCyan: '#8fe2d9',
  brightWhite: '#f8f4ec',
};

const LIGHT: ITheme = {
  background: '#fbf9f4',
  foreground: '#1e1b17',
  cursor: '#ae4a0a',
  cursorAccent: '#fbf9f4',
  selectionBackground: 'rgba(174, 74, 10, 0.22)',
  selectionInactiveBackground: 'rgba(174, 74, 10, 0.14)',
  black: '#1e1b17',
  red: '#b5362a',
  green: '#2b7a36',
  yellow: '#8f6200',
  blue: '#1b62a6',
  magenta: '#7a45b5',
  cyan: '#0e7269',
  white: '#6e675c',
  brightBlack: '#6e675c',
  brightRed: '#c13f2f',
  brightGreen: '#2f8239',
  brightYellow: '#996a00',
  brightBlue: '#2270ba',
  brightMagenta: '#8850c8',
  brightCyan: '#107d73',
  brightWhite: '#3f3a33',
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
