// Service worker for the terminal app.
//
// Responsibilities:
//   - Receive push events from the browser's push service.
//   - Display the notification.
//   - On click, focus an existing window if one is open at the same URL, or
//     open a new one.
//
// Intentionally no offline caching — the app is online-only and we don't
// want stale JS/CSS shipped via the SW lifecycle.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The app may be mounted under a path prefix (the worker's scope), so every
// app-relative path in a payload ("/?session=x", "/icon-192.png") is resolved
// against the scope instead of the origin root. Absolute URLs pass through.
function inScope(path) {
  return new URL(String(path || '').replace(/^\/+/, ''), self.registration.scope).href;
}

self.addEventListener('push', (event) => {
  /** @type {{ title?: string, body?: string, url?: string, tag?: string, icon?: string, data?: object }} */
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Non-JSON payload; fall back to text
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Terminal';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'default',
    renotify: true,
    icon: inScope(payload.icon || 'icon-192.png'),
    badge: inScope('icon-192.png'),
    data: {
      ...(payload.data || {}),
      url: inScope((payload.data && payload.data.url) || payload.url || ''),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    (async () => {
      // Only our own windows: under a path prefix the origin is shared with
      // the host app, whose tabs must not be focused or navigated by us.
      const allClients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .filter((c) => c.url.startsWith(self.registration.scope));
      // If we already have a window open, focus it. Prefer one already on this URL.
      const exact = allClients.find((c) => c.url === url);
      if (exact) return exact.focus();
      if (allClients.length > 0) {
        const client = allClients[0];
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(url); } catch {}
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
