// Where the app is mounted.
//
// Normally that is the origin root, but the app also has to work behind
// path-prefixing reverse proxies — notably another terminal server's local
// proxy, which serves it at /lp/<port>/. Nothing may assume the origin root:
// API calls, websockets, in-app routes, the service worker and static assets
// all hang off this prefix. (An absolute "/api/sessions" under such a proxy
// would silently talk to the *host* app's API instead of ours.)

function detectBase(): string {
  if (import.meta.env.DEV) return '/';
  // Built chunks live in <base>assets/. A chunk's own URL is the one thing
  // that is right whatever route the page was opened on.
  try {
    const path = new URL(/* @vite-ignore */ '..', import.meta.url).pathname;
    return path.endsWith('/') ? path : `${path}/`;
  } catch {
    return '/';
  }
}

/** Mount path, always with a trailing slash: "/" or "/lp/3102/". */
export const BASE = detectBase();

/** Mount path without the trailing slash, for `${API}/api/...`: "" or "/lp/3102". */
export const API = BASE.replace(/\/$/, '');

/** Absolute ws(s):// URL for one of our websocket endpoints ("/ws/terminal?..."). */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${API}${path}`;
}

/** Path of an in-app route ("" = home, "canvas"). */
export function appPath(route = ''): string {
  return BASE + route.replace(/^\//, '');
}

/** The current location's route, relative to the mount path ("" or "canvas"). */
export function currentRoute(): string {
  const p = window.location.pathname;
  return p.startsWith(BASE) ? p.slice(BASE.length).replace(/\/$/, '') : '';
}

/**
 * URL of the local reverse proxy for a port on the server's machine.
 *
 * When we are ourselves being served through a host terminal server's proxy
 * (/lp/<n>/), other ports are reached through that same host proxy: nesting
 * ours inside it would make the host's Referer fallback misroute the proxied
 * page's absolute-path requests back to us.
 */
export function localProxyPath(port: number, path = '/'): string {
  const root = /^\/lp\/\d{1,5}\/$/.test(BASE) ? '' : API;
  return `${root}/lp/${port}${path.startsWith('/') ? path : `/${path}`}`;
}
