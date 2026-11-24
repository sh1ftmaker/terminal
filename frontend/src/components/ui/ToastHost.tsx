import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { currentToast, subscribeToast } from './toast';

export default function ToastHost() {
  const current = useSyncExternalStore(subscribeToast, currentToast);
  const host = document.getElementById('root');
  if (!current || !host) return null;
  return createPortal(
    <div key={current.id} className="toast" role="status" aria-live="polite">{current.text}</div>,
    host,
  );
}
