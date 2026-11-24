// Coordinator mode, end to end, against the PRIVATE contexts of the demo
// instance (/tmp/bt-fable-<ctx>.sock, reached with sudo -n -u agent-<ctx>).
// Never touches the production sockets. Files checks are read-only.
import { withBrowser, newPhone, sleep } from './lib.mjs';
import { execFileSync } from 'child_process';

const BASE = (process.env.BASE || 'http://localhost:3102').replace(/\/$/, '');
const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
const sh = (cmd, args) => execFileSync(cmd, args, { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const admin = (...a) => sh('tmux', ['-S', '/tmp/bt-fable-tmux.sock', ...a]);
const agent = (ctx, ...a) => sh('sudo', ['-n', '-u', `agent-${ctx}`, '--', 'tmux', '-S', `/tmp/bt-fable-${ctx}.sock`, ...a]);
const has = (fn) => { try { fn(); return true; } catch { return false; } };
const prodSockets = () => sh('bash', ['-c', 'stat -c "%n %Y %i" /tmp/orchestrator-tmux.sock /tmp/terminal-*.sock /run/user/1000/terminal-s*.sock 2>/dev/null | sort']);

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const key = (page, re) => page.getByRole('button', { name: re }).first();
const tapTerm = async (page) => { const v = page.viewportSize(); await page.touchscreen.tap(Math.round(v.width / 2), Math.round(v.height * 0.4)); await sleep(350); };

for (const [ctx, s] of [['work', 'verify-ctx'], ['john', 'verify-john']]) try { agent(ctx, 'kill-session', '-t', `=${s}`); } catch {}
const before = prodSockets();

await withBrowser(async (browser) => {
  const { context, page } = await newPhone(browser, { scheme: 'dark' });
  const apiCalls = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/\/api\/files/.test(u.pathname)) apiCalls.push(u.pathname + u.search); });

  await page.goto(BASE + '/'); await sleep(2000);
  await page.getByRole('radio', { name: /^All/ }).tap(); await sleep(500);

  // --- listing -------------------------------------------------------------
  const sections = await page.locator('main section').evaluateAll((els) => els.map((el) => ({
    head: el.querySelector('.eyebrow')?.textContent || '', names: [...el.querySelectorAll('li .font-mono')].map((n) => n.textContent),
  })));
  const by = Object.fromEntries(sections.map((s) => [s.head, s.names]));
  check('sessions are grouped by context', by.Admin?.includes('api-server') && by.Work?.includes('billing-api') && by.Untrusted?.includes('scraper-sandbox') && by.John?.includes('paper-notes'), JSON.stringify(by));
  const chips = await page.getByRole('radio').allTextContents();
  check('switcher lists every context with its count', ['All', 'Admin', 'Work', 'John', 'Untrusted', 'Tom'].every((n) => chips.some((c) => c.trim().startsWith(n))), JSON.stringify(chips.map((c) => c.trim())));

  // --- switching -----------------------------------------------------------
  await page.getByRole('radio', { name: /^Work/ }).tap(); await sleep(500);
  const workOnly = await page.locator('main li .font-mono').allTextContents();
  check('selecting Work shows only Work sessions', workOnly.includes('billing-api') && workOnly.includes('docs-site') && !workOnly.includes('api-server'), JSON.stringify(workOnly));
  check('summary names the context', /in Work/.test(await page.locator('header p').textContent()));
  await page.reload(); await sleep(1800);
  check('the selected context is remembered', (await page.getByRole('radio', { name: /^Work/ }).getAttribute('aria-checked')) === 'true');

  // --- creating in the selected context -------------------------------------
  await page.getByRole('button', { name: 'New session', exact: true }).tap(); await sleep(400);
  check('new-session sheet preselects the viewed context', (await page.getByRole('radiogroup', { name: 'Context for the new session' }).getByRole('radio', { name: 'Work' }).getAttribute('aria-checked')) === 'true');
  check('sheet says which account it runs as', /Runs as agent-work/.test(await page.locator('.sheet').textContent()));
  await page.keyboard.type('verify-ctx');
  await page.getByRole('button', { name: 'Create in Work' }).tap(); await sleep(2800);
  check('created session opens with its context in the URL', /session=verify-ctx/.test(page.url()) && /context=work/.test(page.url()), page.url());
  check("session exists on the Work context's private socket", has(() => agent('work', 'has-session', '-t', '=verify-ctx')));
  check('...and not on the admin socket', !has(() => admin('has-session', '-t', '=verify-ctx')));
  check('terminal header shows the context', /Work/.test(await page.locator('header .chip').first().textContent()));

  // --- attaching + typing as the other account ------------------------------
  await tapTerm(page);
  await page.keyboard.type('echo "i-am-$(whoami)-$((6*7))"\n'); await sleep(900);
  let pane = agent('work', 'capture-pane', '-p', '-J', '-t', '=verify-ctx:');
  check('typed command runs as agent-work', pane.includes('i-am-agent-work-42'), JSON.stringify(pane.trim().split('\n').slice(-2)));
  await page.keyboard.type('cat -v\n'); await sleep(400);
  await key(page, /^Control/).tap(); await sleep(100); await page.keyboard.type('a'); await sleep(100);
  await key(page, /^Up$/).tap(); await sleep(150); await key(page, /^Shift\+Tab$/).tap(); await sleep(150);
  await key(page, /^Enter$/).tap(); await sleep(300);
  pane = agent('work', 'capture-pane', '-p', '-J', '-t', '=verify-ctx:');
  check('key bar and modifiers work in a non-admin context', pane.includes('^A^[[A^[[Z'), JSON.stringify(pane.trim().split('\n').slice(-3)));
  await key(page, /^Interrupt/).tap(); await sleep(300);
  check("window is sized to the phone in the agent's tmux too", Number(agent('work', 'display-message', '-p', '-t', '=verify-ctx:', '#{window_width}')) < 70);

  // --- files in the context (read-only) -------------------------------------
  await page.getByRole('tab', { name: 'Files' }).tap(); await sleep(1800);
  const crumbs = await page.locator('[aria-label="Current folder"]').textContent().catch(() => '');
  const listed = await page.locator('.screen ul li').count();
  check("Files tab lists the agent's own folder", /Desktop/.test(crumbs) && listed >= 0 && (await page.locator('.text-danger').count()) === 0, `breadcrumb ${JSON.stringify(crumbs)}, ${listed} entries`);
  check('file requests carry the context', apiCalls.length > 0 && apiCalls.every((u) => /context=work/.test(u)), JSON.stringify(apiCalls.slice(0, 3)));
  await page.getByRole('tab', { name: 'Terminal' }).tap(); await sleep(400);

  // --- back, kill from the list ----------------------------------------------
  await page.getByRole('button', { name: 'Back to sessions' }).tap(); await sleep(1200);
  check('new session appears under Work in the list', (await page.locator('main li .font-mono').allTextContents()).includes('verify-ctx'));
  await page.getByRole('button', { name: 'Actions for verify-ctx' }).tap(); await sleep(400);
  check('actions sheet names the context', /Work/.test(await page.locator('.sheet').textContent()));
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(400);
  check('kill confirmation names the context', /in Work/.test(await page.locator('.sheet').last().textContent()));
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(1800);
  check("kill removes it from the Work context's tmux", !has(() => agent('work', 'has-session', '-t', '=verify-ctx')));
  check('the other Work sessions are untouched', has(() => agent('work', 'has-session', '-t', '=billing-api')) && has(() => agent('work', 'has-session', '-t', '=docs-site')));

  // --- create via a section's "+" in another context, kill from the terminal menu
  await page.getByRole('radio', { name: /^All/ }).tap(); await sleep(500);
  await page.getByRole('button', { name: 'New session in John' }).tap(); await sleep(400);
  check('section "+" aims the sheet at that context', /Runs as agent-john/.test(await page.locator('.sheet').textContent()));
  await page.keyboard.type('verify-john');
  await page.getByRole('button', { name: 'Create in John' }).tap(); await sleep(2800);
  await tapTerm(page);
  await page.keyboard.type('echo "i-am-$(whoami)"\n'); await sleep(900);
  check('a second context attaches and runs as its own account', agent('john', 'capture-pane', '-p', '-t', '=verify-john:').includes('i-am-agent-john'));
  await page.getByRole('button', { name: 'Session menu and settings' }).tap(); await sleep(400);
  check('session menu shows context and account', /John/.test(await page.locator('.sheet').textContent()) && /runs as agent-john/.test(await page.locator('.sheet').textContent()));
  await page.getByRole('button', { name: 'Kill' }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(3000);
  check('kill from the terminal menu works in a context (and it is not re-created)', !has(() => agent('john', 'has-session', '-t', '=verify-john')));

  // --- ports pane per context ---------------------------------------------------
  await page.getByRole('tab', { name: 'Ports' }).tap(); await sleep(2000);
  const heads = await page.locator('main .eyebrow').allTextContents();
  check('ports are grouped under their context', heads.includes('Admin'), JSON.stringify(heads));
  await page.getByRole('radio', { name: /^Tom/ }).tap(); await sleep(500);
  check('ports pane follows the context switcher', /Nothing is listening in this context|Tom/.test(await page.locator('main').textContent()));
  await page.getByRole('radio', { name: /^All/ }).tap(); await sleep(300);
  await page.getByRole('tab', { name: 'Sessions' }).tap(); await sleep(300);
  await context.close();
});

check('production sockets untouched (same inode, same mtime)', prodSockets() === before, prodSockets() === before ? '' : `${before}\n-- now --\n${prodSockets()}`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
