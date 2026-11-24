// Push-notification controls: a bell for the home header and a labelled row
// for Settings, sharing one piece of state.

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { getPushState, subscribeUserToPush, unsubscribeFromPush, type PushState } from '../lib/push';
import Switch from './ui/Switch';
import { toast } from './ui/toast';

let cached: PushState | null = null;
const listeners = new Set<(s: PushState) => void>();
function publish(next: PushState) {
  cached = next;
  listeners.forEach((fn) => fn(next));
}

function useNotifications() {
  const [state, setState] = useState<PushState | null>(cached);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listeners.add(setState);
    if (!cached) getPushState().then(publish).catch(() => {});
    return () => { listeners.delete(setState); };
  }, []);

  const toggle = useCallback(async () => {
    if (busy || !state) return;
    setBusy(true);
    try {
      if (state.status === 'subscribed') {
        publish(await unsubscribeFromPush());
        toast('Notifications off');
      } else if (state.status === 'unsubscribed' || state.status === 'denied') {
        const next = await subscribeUserToPush(navigator.userAgent.slice(0, 80));
        publish(next);
        toast(next.status === 'subscribed' ? 'Notifications on' : 'Notifications are blocked for this site');
      }
    } catch (e) {
      console.error('notification toggle failed:', e);
      toast('Could not change notifications');
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  return { state, busy, toggle };
}

function describe(state: PushState): string {
  switch (state.status) {
    case 'subscribed': return 'On for this device';
    case 'unsubscribed': return 'Get a push when a session needs you';
    case 'denied': return 'Blocked in the browser settings for this site';
    case 'not-installed-ios': return 'Add this app to the Home Screen first (Share, then Add to Home Screen)';
    default: return 'Not supported in this browser';
  }
}

/** Icon button for the home header. Hidden where push cannot work at all. */
export function NotificationBell() {
  const { state, busy, toggle } = useNotifications();
  // Where it cannot work yet (unsupported browser, iOS before "Add to Home
  // Screen") the header stays quiet; the Settings row explains what to do.
  if (!state || state.status === 'unsupported' || state.status === 'not-installed-ios') return null;

  const on = state.status === 'subscribed';
  const actionable = state.status === 'subscribed' || state.status === 'unsubscribed';
  const Icon = on ? BellRing : state.status === 'unsubscribed' ? Bell : BellOff;
  return (
    <button
      className={`icon-btn ${on ? 'is-on' : ''}`}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? 'Notifications on' : 'Notifications off'}
      title={describe(state)}
      onClick={actionable ? toggle : () => toast(describe(state), 3200)}
    >
      <Icon size={20} strokeWidth={1.9} />
    </button>
  );
}

/** Settings row: explanation plus a switch. */
export default function NotificationRow() {
  const { state, busy, toggle } = useNotifications();
  if (!state) return null;
  const actionable = state.status === 'subscribed' || state.status === 'unsubscribed' || state.status === 'denied';
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">Push notifications</div>
        <div className="text-[13px] text-ink-2 mt-0.5">{describe(state)}</div>
      </div>
      <Switch
        label="Push notifications"
        checked={state.status === 'subscribed'}
        disabled={busy || !actionable || state.status === 'denied'}
        onChange={toggle}
      />
    </div>
  );
}
