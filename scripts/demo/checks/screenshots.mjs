// Screenshot set -> <repo>/screenshots, from the running coordinator-mode
// demo. The path-prefix shots expect a second instance on :3122 (see README).
// usage: node screenshots.mjs [filter-regex]
import { withBrowser, newPhone, sleep, PHONE, PHONE_LANDSCAPE, REPO } from './lib.mjs';
import fs from 'fs';
import { execFileSync, execSync } from 'child_process';
const OUT = `${REPO}screenshots/`;
const FILTER = new RegExp(process.argv[2] || '.');
const BASE = 'http://localhost:3102';
const PREFIXED = 'http://localhost:3122/lp/3102';
fs.mkdirSync(OUT, { recursive: true });
const KB = 336, KB_LAND = 200;
const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };
const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
const tmux = (...a) => execFileSync('tmux', ['-S', '/tmp/bt-fable-tmux.sock', ...a], { env, encoding: 'utf-8' });

const scenarios = [];
const sc = (name, opts, fn) => scenarios.push({ name, opts, fn });
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });
const tapTerm = async (page) => { const v = page.viewportSize(); await page.touchscreen.tap(Math.round(v.width / 2), Math.round(v.height * 0.35)); await sleep(300); };
const openKb = async (page, h) => { await page.setViewportSize({ width: page.viewportSize().width, height: h }); await sleep(800); };

// A keyboard-open shot shows only the visible area; draw the keyboard it sits on.
async function withKeyboard(browser, page, name, scheme, { width = 390, full = 844 } = {}) {
  const buf = await page.screenshot();
  const kbH = full - page.viewportSize().height;
  const dark = scheme === 'dark';
  const rows = width > 600 ? ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const keyH = Math.floor((kbH - (width > 600 ? 50 : 96)) / 4);
  const row = (letters, pad) => `<div style="display:flex;gap:6px;justify-content:center;padding:0 ${pad}px">${[...letters].map((l) => `<span class="k">${l}</span>`).join('')}</div>`;
  const html = `<body style="margin:0;background:${dark ? '#2b2b2d' : '#d1d4d9'};width:${width}px;height:${full}px;overflow:hidden;font:400 ${width > 600 ? 16 : 22}px -apple-system,system-ui,sans-serif">
    <style>.k{flex:1;max-width:${width > 600 ? 64 : 34}px;height:${keyH}px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:${dark ? '#6b6b6e' : '#fff'};color:${dark ? '#fff' : '#000'};box-shadow:0 1px 0 ${dark ? '#1a1a1a' : '#898a8d'}}
    .kb{position:absolute;left:0;right:0;bottom:0;height:${kbH}px;display:flex;flex-direction:column;gap:${width > 600 ? 6 : 11}px;padding-top:${width > 600 ? 8 : 10}px;box-sizing:border-box}
    .note{position:absolute;left:0;right:0;bottom:${width > 600 ? 4 : 30}px;text-align:center;font-size:11px;color:${dark ? '#9a9a9e' : '#666'}}</style>
    <img src="data:image/png;base64,${buf.toString('base64')}" style="display:block;width:${width}px">
    <div class="kb">${row(rows[0], 3)}${row(rows[1], 20)}${row(rows[2], 56)}
      <div style="display:flex;gap:6px;justify-content:center;padding:0 3px"><span class="k" style="max-width:90px">123</span><span class="k" style="max-width:none;flex:5">space</span><span class="k" style="max-width:90px">return</span></div>
    </div><div class="note">soft keyboard (simulated)</div></body>`;
  const context = await browser.newContext({ viewport: { width, height: full }, deviceScaleFactor: 3 });
  const p2 = await context.newPage();
  await p2.setContent(html); await p2.waitForLoadState('load'); await sleep(150);
  await p2.screenshot({ path: `${OUT}${name}.png` });
  await context.close();
}

for (const scheme of ['dark', 'light']) {
  sc(`home-${scheme}`, { scheme }, async (page) => {
    await page.goto(BASE + '/'); await sleep(1800);
    await shot(page, `01-home-${scheme}`);
    await page.getByRole('radio', { name: /^Work/ }).tap(); await sleep(600);
    await shot(page, `02-home-context-work-${scheme}`);
    await page.getByRole('radio', { name: /^Tom/ }).tap(); await sleep(600);
    await shot(page, `03-home-context-empty-${scheme}`);
    await page.getByRole('radio', { name: /^All/ }).tap(); await sleep(400);
    await page.getByRole('button', { name: 'Actions for web-ui' }).tap(); await sleep(500);
    await shot(page, `05-session-actions-${scheme}`);
    await page.getByRole('button', { name: 'Cancel' }).tap(); await sleep(400);
    await page.getByRole('tab', { name: 'Ports' }).tap(); await sleep(2000);
    await shot(page, `06-ports-${scheme}`);
    await page.getByRole('tab', { name: 'Sessions' }).tap(); await sleep(400);
    await page.getByRole('button', { name: 'Settings' }).tap(); await sleep(500);
    await shot(page, `07-settings-${scheme}`);
  });
  sc(`new-session-${scheme}`, { scheme }, async (page, browser) => {
    await page.goto(BASE + '/'); await sleep(1500);
    await page.getByRole('radio', { name: /^Work/ }).tap(); await sleep(400);
    await page.getByRole('button', { name: 'New session', exact: true }).tap(); await sleep(400);
    await page.keyboard.type('ledger migration');
    await openKb(page, PHONE.height - KB);
    await withKeyboard(browser, page, `04-new-session-keyboard-${scheme}`, scheme);
  });
  sc(`terminal-${scheme}`, { scheme }, async (page) => {
    await page.goto(BASE + '/?session=web-ui'); await sleep(2600);
    await shot(page, `10-terminal-${scheme}`);
    await page.getByRole('button', { name: /^Copy/ }).tap(); await sleep(500);
    await shot(page, `13-terminal-select-text-${scheme}`);
  });
  sc(`terminal-keyboard-${scheme}`, { scheme }, async (page, browser) => {
    tmux('send-keys', '-t', '=scratch:', 'C-u'); tmux('send-keys', '-t', '=scratch:', 'clear', 'Enter');
    await page.goto(BASE + '/?session=scratch'); await sleep(2400);
    await tapTerm(page); await openKb(page, PHONE.height - KB);
    await page.keyboard.type('git log --oneline');
    await page.getByRole('button', { name: /^Control/ }).tap(); await sleep(300);
    await withKeyboard(browser, page, `11-terminal-keyboard-ctrl-armed-${scheme}`, scheme);
    await page.keyboard.press('Control+u'); await sleep(150);   // also releases the armed ctrl
    await page.getByRole('button', { name: /^Compose/ }).tap(); await sleep(300);
    await page.keyboard.type('Add rate limiting to the POST handler and write a test for the 429 path');
    await sleep(300);
    await withKeyboard(browser, page, `12-terminal-compose-${scheme}`, scheme);
  });
  sc(`context-terminal-${scheme}`, { scheme }, async (page) => {
    await page.goto(BASE + '/?session=billing-api&context=work'); await sleep(2800);
    await shot(page, `14-terminal-context-work-${scheme}`);
    await page.getByRole('button', { name: 'Session menu and settings' }).tap(); await sleep(500);
    await shot(page, `15-session-menu-context-${scheme}`);
  });
  sc(`files-${scheme}`, { scheme }, async (page) => {
    await page.goto(BASE + '/?session=scratch'); await sleep(1500);
    await page.getByRole('tab', { name: 'Files' }).tap(); await sleep(1500);
    await shot(page, `20-files-${scheme}`);
    await page.getByText('api', { exact: true }).tap(); await sleep(700);
    await page.getByText('src', { exact: true }).tap(); await sleep(700);
    await page.getByText('server.ts').tap(); await sleep(1500);
    await shot(page, `21-file-viewer-${scheme}`);
  });
  sc(`standalone-${scheme}`, { scheme, insets: INSETS }, async (page) => {
    await page.goto(BASE + '/'); await sleep(1800);
    await shot(page, `30-installed-pwa-home-${scheme}`);
    await page.goto(BASE + '/?session=web-ui'); await sleep(2600);
    await shot(page, `31-installed-pwa-terminal-${scheme}`);
  });
  sc(`landscape-${scheme}`, { scheme, viewport: PHONE_LANDSCAPE, insets: { top: 0, bottom: 21, left: 59, right: 59 } }, async (page, browser) => {
    await page.goto(BASE + '/?session=api-server'); await sleep(2600);
    await shot(page, `32-landscape-terminal-${scheme}`);
    await page.touchscreen.tap(422, 150); await sleep(300);
    await openKb(page, 390 - KB_LAND);
    await withKeyboard(browser, page, `33-landscape-keyboard-${scheme}`, scheme, { width: 844, full: 390 });
  });
  sc(`desktop-${scheme}`, { scheme, viewport: { width: 1280, height: 800 }, mobile: false, dpr: 2 }, async (page) => {
    await page.goto(BASE + '/'); await sleep(1800);
    await shot(page, `40-desktop-home-${scheme}`);
    await page.goto(BASE + '/?session=web-ui'); await sleep(2600);
    await shot(page, `41-desktop-terminal-${scheme}`);
  });
}

sc('preview', { scheme: 'dark' }, async (page) => {
  await page.goto(BASE + '/?session=web-ui'); await sleep(2500);
  await page.getByRole('tab', { name: 'Preview' }).tap(); await sleep(1500);
  await shot(page, '22-preview-tab-dark');
});
sc('reconnect', { scheme: 'dark' }, async (page) => {
  await page.goto(BASE + '/?session=scratch'); await sleep(2400);
  execSync('sbg stop bt-fable', { cwd: REPO, stdio: 'ignore' }); await sleep(1500);
  await shot(page, '16-reconnecting-dark');
  execSync('sbg start bt-fable -- ./scripts/demo/run-server.sh', { cwd: REPO, stdio: 'ignore' }); await sleep(3500);
});
sc('prefix', { scheme: 'dark' }, async (page) => {
  await page.goto(PREFIXED + '/'); await sleep(2000);
  await page.evaluate(() => { const b = document.createElement('div'); b.textContent = location.host + location.pathname; b.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:999;font:11px ui-monospace,monospace;background:#000c;color:#fff;padding:3px 8px;border-radius:99px'; document.body.appendChild(b); });
  await shot(page, '50-under-path-prefix-home-dark');
  await page.goto(PREFIXED + '/?session=billing-api&context=work'); await sleep(2800);
  await page.evaluate(() => { const b = document.createElement('div'); b.textContent = location.host + location.pathname + location.search; b.style.cssText = 'position:fixed;left:50%;top:52px;transform:translateX(-50%);z-index:999;font:11px ui-monospace,monospace;background:#000c;color:#fff;padding:3px 8px;border-radius:99px;white-space:nowrap'; document.body.appendChild(b); });
  await shot(page, '51-under-path-prefix-context-terminal-dark');
});
sc('canvas', { scheme: 'dark' }, async (page) => { await page.goto(BASE + '/canvas'); await sleep(3500); await shot(page, '60-canvas-phone'); });
sc('canvas-desktop', { scheme: 'dark', viewport: { width: 1280, height: 800 }, mobile: false, dpr: 2 }, async (page) => {
  await page.goto(BASE + '/canvas'); await sleep(3500);
  await shot(page, '61-canvas-desktop');
  await page.locator('.tile', { hasText: 'billing-api' }).first().locator('button[title^="Interact"]').evaluate((b) => b.click());
  await sleep(2500);
  await shot(page, '62-canvas-terminal-overlay');
});

// A pending share request needs an agent account to file one: mocked data.
sc('share-request', { scheme: 'dark' }, async (page, browser, context) => {
  const now = Date.now();
  await context.route(/\/api\/share\/overview$/, async (route) => {
    const res = await route.fetch(); const data = await res.json();
    data.requests = [{ id: 'r1', port: 4321, minutes: 120, label: 'Docs preview', session: 'scraper-sandbox', account: 'untrusted', uid: 1004, listening: true, createdAt: now - 3 * 60000, status: 'pending', decidedAt: null, url: null, expiresAt: null }];
    await route.fulfill({ response: res, json: data });
  });
  await page.goto(BASE + '/'); await sleep(2200);
  await shot(page, '08-share-request-pending-dark-MOCKED');
});

await withBrowser(async (browser) => {
  for (const s of scenarios.filter((x) => FILTER.test(x.name))) {
    const { context, page } = await newPhone(browser, s.opts);
    try { await s.fn(page, browser, context); console.log('ok  ', s.name); }
    catch (e) { console.log('FAIL', s.name, String(e).split('\n')[0]); }
    await context.close();
  }
});
