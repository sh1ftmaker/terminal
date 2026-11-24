// Ports & shares overview, shared by the Ports pane, the request cards on
// the Sessions pane and the pending-count badge.

import { useCallback, useEffect, useState } from 'react';
import { fetchOverview, type Overview, type ShareRequest } from './share';

export interface OverviewState {
  data: Overview | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Polls the overview; faster while the pane is on screen. */
export function useOverview(fast: boolean): OverviewState {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setData(await fetchOverview()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, fast ? 5000 : 15000);
    return () => clearInterval(id);
  }, [fast, refresh]);

  return { data, error, refresh };
}

export function pendingRequests(data: Overview | null): ShareRequest[] {
  return data?.requests.filter((r) => r.status === 'pending') ?? [];
}
