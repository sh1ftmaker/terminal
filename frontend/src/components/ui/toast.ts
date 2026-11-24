// One short-lived message at a time ("Copied", "Killed api-server").
// Rendered by <ToastHost />.

export interface ToastMessage { id: number; text: string }

let message: ToastMessage | null = null;
let timer = 0;
const listeners = new Set<() => void>();

export function toast(text: string, ms = 1800): void {
  message = { id: Date.now(), text };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { message = null; listeners.forEach((fn) => fn()); }, ms);
  listeners.forEach((fn) => fn());
}

export function subscribeToast(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function currentToast(): ToastMessage | null {
  return message;
}
