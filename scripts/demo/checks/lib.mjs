// Browser harness for the demo checks: drives a Chromium over CDP (default
// http://localhost:9222, override with CDP_URL) in its own browser context,
// closed afterwards. Other tabs are never touched.
import { chromium } from 'playwright-core';

/** Repository root. */
export const REPO = new URL('../../../', import.meta.url).pathname;

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export const PHONE = { width: 390, height: 844 };
export const PHONE_LANDSCAPE = { width: 844, height: 390 };

export async function withBrowser(fn) {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://localhost:9222');
  try { await fn(browser); } finally { await browser.close(); } // disconnects only
}

export async function newPhone(browser, opts = {}) {
  const mobile = opts.mobile !== false;
  const context = await browser.newContext({
    viewport: opts.viewport || PHONE,
    deviceScaleFactor: opts.dpr ?? (mobile ? 3 : 1),
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile ? IPHONE_UA : undefined,
    colorScheme: opts.scheme || 'dark',
    reducedMotion: opts.reducedMotion || 'no-preference',
  });
  // Safety net: automation must never stop a process or publish a port.
  await context.route(/\/api\/ports\/\d+\/stop/, (r) => r.abort());
  await context.route(/\/api\/share(\/|$|\?)/, (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  // prefers-color-scheme emulation on the shared browser proved flaky, so
  // the theme is pinned through the app's own setting instead.
  if (opts.scheme) {
    await context.addInitScript((theme) => {
      try {
        const m = location.pathname.match(/^\/lp\/\d+\//);           // same namespacing as src/lib/storage.ts
        const key = (m ? `${m[0]}|` : '') + 'terminal.settings';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        if (!cur.theme || cur.theme === 'system') localStorage.setItem(key, JSON.stringify({ ...cur, theme }));
      } catch {}
    }, opts.scheme);
  }
  const page = await context.newPage();
  if (opts.insets) {
    const cdp = await context.newCDPSession(page);
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: opts.insets }); }
    catch (e) { console.warn('safe-area override unsupported:', e.message); }
  }
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
  return { context, page };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
