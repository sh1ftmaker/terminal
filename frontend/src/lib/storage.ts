// localStorage, scoped to the mount path.
//
// At the origin root the keys are the plain ones the app has always used.
// Under a path prefix the origin is shared with whatever else is hosted on
// it — possibly another copy of this very app — so every key is namespaced
// by the mount path: one instance's theme, last folder or home view never
// leaks into the other's. The inline theme script in index.html builds the
// same key.

import { BASE } from './base';

const NS = BASE === '/' ? '' : `${BASE}|`;

export const store = {
  /** The real localStorage key (for `storage` events). */
  key: (key: string): string => NS + key,
  get(key: string): string | null {
    try { return localStorage.getItem(NS + key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(NS + key, value); } catch { /* private mode / full */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
  },
};
