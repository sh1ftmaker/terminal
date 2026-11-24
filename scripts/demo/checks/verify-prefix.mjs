// The app behind a path-prefixing proxy: a second server instance ("host",
// :3122, with its own tmux socket holding a session named HOST-ONLY) serves
// the demo app at /lp/3102/ through the same proxy code the production host
// uses. Any request that escapes the prefix would hit the host's own API.
import { withBrowser, newPhone, sleep } from './lib.mjs';
import { execFileSync } from 'child_process';
const HOST = 'http://localhost:3122';
const PREFIX = '/lp/3102/';
const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
const tmux = (...a) => execFileSync('tmux', ['-S', '/tmp/bt-fable-tmux.sock', ...a], { env, encoding: 'utf-8' }).trim();
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const S = 'verify-px';
try { tmux('kill-session', '-t', `=${S}`); } catch {}

await withBrowser(async (browser) => {
  const { context, page } = await newPhone(browser, { scheme: 'dark' });
  const escaped = [];
  const sockets = [];
  const failed = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== HOST) return;
    if (!u.pathname.startsWith(PREFIX) && !/^\/lp\/\d+\//.test(u.pathname)) escaped.push(`${r.method()} ${u.pathname}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('websocket', (ws) => sockets.push(new URL(ws.url()).pathname));

  // No trailing slash: the inline script must add it before assets load.
  await page.goto(`${HOST}/lp/3102`);
  await sleep(2200);
  check('redirects /lp/3102 to /lp/3102/', new URL(page.url()).pathname === PREFIX, page.url());
  // Requests the preload scanner fired before that redirect don't count.
  escaped.length = 0;
  const text = await page.locator('main').textContent();
  check('lists the demo sessions (our API)', /api-server/.test(text) && /web-ui/.test(text));
  check("does not show the host's sessions", !/HOST-ONLY/.test(text));
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, '')));
  check('bundled fonts load from under the prefix', fonts.some((f) => /Geist/.test(f)) && fonts.some((f) => /JetBrains/.test(f)), JSON.stringify([...new Set(fonts)]));

  await page.getByRole('tab', { name: 'Ports' }).tap(); await sleep(1500);
  const link = await page.locator('button[title^="Open privately"]').first().getAttribute('title');
  check("port links use the host's proxy root", /localhost:3122\/lp\/\d+\/$/.test(link || ''), link);
  await page.getByRole('tab', { name: 'Sessions' }).tap(); await sleep(400);

  await page.getByRole('button', { name: 'New session', exact: true }).tap(); await sleep(300);
  await page.keyboard.type(S);
  await page.getByRole('button', { name: /^Create/ }).tap(); await sleep(2500);
  check('session URL stays under the prefix', new URL(page.url()).pathname === PREFIX && page.url().includes(`session=${S}`), page.url());
  check('session was created on OUR tmux socket', (() => { try { tmux('has-session', '-t', `=${S}`); return true; } catch { return false; } })());
  check('terminal websocket goes through the prefix', sockets.length > 0 && sockets.every((p) => p.startsWith(PREFIX)), JSON.stringify(sockets));
  const v = page.viewportSize();
  await page.touchscreen.tap(v.width / 2, v.height * 0.4); await sleep(300);
  await page.keyboard.type('echo prefixed-$((6*7))\n'); await sleep(700);
  check('typing reaches tmux through the proxied websocket', tmux('capture-pane', '-p', '-t', `=${S}:`).includes('prefixed-42'));

  await page.getByRole('tab', { name: 'Files' }).tap(); await sleep(1500);
  check('file browser lists the workspace', /README\.md/.test(await page.locator('ul').first().textContent()));
  await page.getByText('README.md').tap(); await sleep(1500);
  check('file viewer loads content (lazy chunk + API)', /Demo workspace/.test(await page.locator('.code-view').textContent().catch(() => '')));

  await page.goBack(); await sleep(1200);
  check('browser back returns to the list under the prefix', new URL(page.url()).pathname === PREFIX && !page.url().includes('session='), page.url());

  await page.getByRole('button', { name: 'Canvas view' }).tap(); await sleep(3000);
  check('canvas route is prefixed', new URL(page.url()).pathname === `${PREFIX}canvas`, page.url());
  check('canvas websocket is prefixed', sockets.some((p) => p === `${PREFIX}ws/canvas`), JSON.stringify(sockets));
  await page.reload(); await sleep(3000);
  check('deep link to the prefixed canvas route loads the app', (await page.locator('.canvas-root').count()) === 1);
  await page.getByRole('tab', { name: 'Sessions' }).tap(); await sleep(800);
  check('leaving the canvas returns to the prefixed root', new URL(page.url()).pathname === PREFIX, page.url());

  // The dangerous one: a real navigation (not pushState) to an in-app route,
  // which carries a Referer under /lp/3102/. Our server has no /canvas route,
  // so before the self-port guard its Referer fallback proxied the request to
  // itself, forever.
  const t0 = Date.now();
  await page.evaluate((p) => { window.location.href = `${p}canvas`; }, PREFIX);
  await page.waitForLoadState('load'); await sleep(3000);
  check('navigating to /canvas with an in-app Referer loads (no proxy loop)', (await page.locator('.canvas-root').count()) === 1, `${Date.now() - t0}ms`);
  const socketsOpen = Number(execFileSync('bash', ['-c', 'ss -tn | grep -c ":3102" || true'], { encoding: 'utf-8' }).trim());
  check('the server did not start talking to itself', socketsOpen < 200, `${socketsOpen} sockets on :3102`);
  const api0 = Date.now();
  const apiOk = await page.evaluate(async (p) => (await fetch(`${p}api/contexts`)).ok, PREFIX);
  check('and still answers promptly', apiOk && Date.now() - api0 < 1500, `${Date.now() - api0}ms`);
  const tiles = await page.locator('.canvas-root').textContent();
  check('canvas shows sessions from every context', /api-server/.test(tiles) && /billing-api/.test(tiles) && /scraper-sandbox/.test(tiles));
  await page.getByRole('tab', { name: 'Sessions' }).tap(); await sleep(800);

  const sw = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.() || []).map((r) => new URL(r.scope).pathname));
  check('no service worker registered outside the prefix', sw.every((s) => s.startsWith('/lp/3102/')), JSON.stringify(sw));
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]').href);
  check('manifest link resolves under the prefix', new URL(manifest).pathname === `${PREFIX}manifest.webmanifest`, manifest);

  check('no request escaped the prefix', escaped.length === 0, JSON.stringify([...new Set(escaped)].slice(0, 8)));
  check('no failed requests', failed.length === 0, JSON.stringify([...new Set(failed)].slice(0, 8)));
  await context.close();
});
try { tmux('kill-session', '-t', `=${S}`); } catch {}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
