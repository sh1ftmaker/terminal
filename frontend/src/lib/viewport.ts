// Visual-viewport tracking: keeps the app exactly as tall as the part of the
// screen that is actually visible, so bottom-docked UI (the key bar, sheets)
// sits on top of the soft keyboard instead of underneath it.
//
// iOS never resizes the layout viewport for the keyboard — it only shrinks
// window.visualViewport and may pan it (offsetTop). Android Chrome resizes
// the layout (interactive-widget=resizes-content). Reading visualViewport
// covers both. Published to CSS on <html>:
//
//   --app-h / --app-top   size and offset of the visible area (#root uses them)
//   data-kb="open"        a soft keyboard is showing
//   data-tight="1"        ...and it left very little height (landscape)

import { useSyncExternalStore } from 'react';

export interface ViewportState {
  width: number;
  height: number;
  keyboardOpen: boolean;
}

const KEYBOARD_MIN = 120;   // anything smaller is browser chrome moving, not a keyboard
const TIGHT_HEIGHT = 300;

const TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

let state: ViewportState = { width: 0, height: 0, keyboardOpen: false };
const listeners = new Set<() => void>();

// Tallest visible height seen at the current width. Where the keyboard
// resizes the layout (Android) there is no other "full height" to compare to.
let baseline = 0;
let baselineWidth = 0;
let frame = 0;
let unpanCount = 0;
let unpanWindowStart = 0;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || (el as HTMLElement).isContentEditable;
}

function measure(): void {
  frame = 0;
  const vv = window.visualViewport;
  const width = Math.round(vv?.width ?? window.innerWidth);
  const height = Math.round(vv?.height ?? window.innerHeight);
  const top = Math.max(0, Math.round(vv?.offsetTop ?? 0));

  if (Math.abs(width - baselineWidth) > 1) {
    baseline = 0;               // rotated or resized: forget the old full height
    baselineWidth = width;
  }
  baseline = Math.max(baseline, height, window.innerHeight);

  // A soft keyboard only exists on touch devices, and only while something
  // editable has focus; without those checks a desktop window dragged
  // shorter would read as "keyboard open".
  const editing = TOUCH && isEditable(document.activeElement);
  const keyboardOpen = editing && baseline - height > KEYBOARD_MIN;
  if (!editing) baseline = Math.max(height, window.innerHeight);

  const root = document.documentElement;
  root.style.setProperty('--app-h', `${height}px`);
  root.style.setProperty('--app-top', `${top}px`);
  if (keyboardOpen) root.dataset.kb = 'open';
  else delete root.dataset.kb;
  if (keyboardOpen && height < TIGHT_HEIGHT) root.dataset.tight = '1';
  else delete root.dataset.tight;

  // iOS pans the page when the keyboard opens and leaves it panned after it
  // closes. A panned page puts the header "under" the status bar, where iOS
  // blurs and fades it. The app is already sized to the visible area, so undo
  // the pan right away. If iOS keeps panning back (it wants a focused field in
  // view), give up until the keyboard closes and rely on --app-top instead.
  // iOS can also shift only the visible area (offsetTop) with scrollY still 0.
  if (window.scrollY !== 0 || window.scrollX !== 0 || top > 0) {
    const now = performance.now();
    if (now - unpanWindowStart > 1000) { unpanWindowStart = now; unpanCount = 0; }
    if (!keyboardOpen || unpanCount < 4) {
      unpanCount++;
      window.scrollTo(0, 0);
      schedule();
    }
  }
  if (!keyboardOpen) unpanCount = 0;

  if (width !== state.width || height !== state.height || keyboardOpen !== state.keyboardOpen) {
    state = { width, height, keyboardOpen };
    listeners.forEach((fn) => fn());
  }
}

function schedule(): void {
  if (!frame) frame = requestAnimationFrame(measure);
}

// The keyboard animates in after focus moves, and iOS reports the final
// geometry late: look again once things have settled.
function scheduleSettled(): void {
  schedule();
  window.setTimeout(schedule, 120);
  window.setTimeout(schedule, 400);
}

let started = false;
export function initViewport(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const vv = window.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', scheduleSettled);
  document.addEventListener('focusin', scheduleSettled);
  document.addEventListener('focusout', scheduleSettled);
  measure();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getViewport(): ViewportState {
  return state;
}

export function useViewport(): ViewportState {
  return useSyncExternalStore(subscribe, getViewport);
}
