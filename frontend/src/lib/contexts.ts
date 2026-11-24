// Coordinator mode: the server can host several "contexts", each a Linux
// account with its own tmux server. GET /api/contexts lists them; an empty
// list means single-context mode and every piece of context UI stays hidden.

import { useEffect, useState } from 'react';
import { API } from './base';
import type { ContextInfo } from './sessions';

let cache: ContextInfo[] | null = null;
let inflight: Promise<ContextInfo[]> | null = null;

export function loadContexts(): Promise<ContextInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${API}/api/contexts`)
      .then((res) => (res.ok ? res.json() : { contexts: [] }))
      .then((data) => {
        cache = Array.isArray(data?.contexts) ? data.contexts : [];
        return cache as ContextInfo[];
      })
      .catch(() => [] as ContextInfo[])   // not cached: retried on next use
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** The contexts, once known. Empty while loading and in single-context mode. */
export function useContexts(): ContextInfo[] {
  const [contexts, setContexts] = useState<ContextInfo[]>(cache ?? []);
  useEffect(() => {
    let cancelled = false;
    loadContexts().then((list) => { if (!cancelled) setContexts(list); });
    return () => { cancelled = true; };
  }, []);
  return contexts;
}

/** Display name of a context ("Work"), falling back to its id. */
export function contextLabel(contexts: ContextInfo[], name: string | null | undefined): string {
  if (!name) return '';
  return contexts.find((c) => c.name === name)?.label || name;
}

/** "agent-work", or null for the admin context (the server's own account). */
export function contextUser(contexts: ContextInfo[], name: string | null | undefined): string | null {
  return contexts.find((c) => c.name === name)?.user ?? null;
}
