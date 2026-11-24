// Functional checks against the running demo instance. Reads the truth from
// tmux itself (capture-pane / display-message on the private demo socket).
import { withBrowser, newPhone, sleep, PHONE } from './lib.mjs';
import { execFileSync } from 'child_process';

const BASE = process.env.BASE || 'http://localhost:3102';
const SOCK = '/tmp/bt-fable-tmux.sock';
const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
const tmux = (...args) => execFileSync('tmux', ['-S', SOCK, ...args], { env, encoding: 'utf-8' }).trim();
const tmuxOk = (...args) => { try { tmux(...args); return true; } catch { return false; } };
const pane = (s) => tmux('capture-pane', '-p', '-J', '-t', `=${s}:`);
const cols = (s) => Number(tmux('display-message', '-p', '-t', `=${s}:`, '#{window_width}'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const key = (page, re) => page.getByRole('button', { name: re }).first();
const press = async (page, re) => { await key(page, re).tap(); await sleep(90); };
const tapTerm = async (page) => { const v = page.viewportSize(); await page.touchscreen.tap(Math.round(v.width / 2), Math.round(v.height * 0.4)); await sleep(350); };
const activeIsTerm = (page) => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false);
const S = 'verify1';

for (const s of [S, 'verify2']) tmuxOk('kill-session', '-t', `=${s}`);

await withBrowser(async (browser) => {
  const { context, page } = await newPhone(browser, { scheme: 'dark' });
  const base = BASE.replace(/\/$/, '');

  // --- attach (auto-creates the session) + typing --------------------------
  await page.goto(`${base}/?session=${S}`);
  await sleep(2500);
  check('session auto-created on connect', tmuxOk('has-session', '-t', `=${S}`));
  const c0 = cols(S);
  check('tmux window width follows the phone viewport', c0 >= 40 && c0 <= 60, `${c0} cols at 390px`);

  // Key bar must not move focus: before any tap nothing is focused...
  await press(page, /^Escape$/);
  check('key press does not summon the keyboard', !(await activeIsTerm(page)));
  await tapTerm(page);
  check('tapping the terminal focuses it', await activeIsTerm(page));
  await page.keyboard.type('echo typed-$((40+2))\n');
  await sleep(600);
  check('typed text reaches tmux', pane(S).includes('typed-42'));

  // --- special keys, seen raw through cat -v --------------------------------
  await page.keyboard.type('cat -v\n'); await sleep(500);
  await press(page, /^Escape$/); await sleep(150);
  await press(page, /^Tab$/);
  await press(page, /^Shift\+Tab$/); await sleep(150);
  await press(page, /^Up$/); await sleep(150);
  await press(page, /^Down$/); await sleep(150);
  await press(page, /^Left$/); await sleep(150);
  await press(page, /^Right$/); await sleep(150);
  check('key press keeps the keyboard up (focus stays in terminal)', await activeIsTerm(page));
  await press(page, /^Slash$/); await press(page, /^Dash$/); await press(page, /^Pipe$/); await press(page, /^Tilde$/);
  await press(page, /^Enter$/); await sleep(300);
  let out = pane(S);
  const line1 = out.split('\n').filter((l) => l.includes('^[')).pop() || '';
  check('esc/tab/backtab/arrows/symbols encode correctly', line1.includes('^[\t^[[Z^[[A^[[B^[[D^[[C/-|~')   /* cat -v leaves TAB as is */, JSON.stringify(line1));

  // --- sticky modifiers -------------------------------------------------------
  await press(page, /^Control/);
  check('ctrl shows as armed', (await key(page, /^Control/).getAttribute('data-mod')) === 'armed');
  await page.keyboard.type('a'); await sleep(120);
  check('ctrl releases after one key', (await key(page, /^Control/).getAttribute('data-mod')) === null);
  await page.keyboard.type('b'); await sleep(120);
  await press(page, /^Alt/); await page.keyboard.type('x'); await sleep(200);
  await press(page, /^Control/); await press(page, /^Up$/); await sleep(200);          // ctrl+up
  await press(page, /^Alt/); await press(page, /^Slash$/); await sleep(200);           // alt+/ (alt+arrows are bound in this tmux.conf)
  await press(page, /^Control/); await press(page, /^Control/); await sleep(120);     // double tap = lock
  check('double-tap locks ctrl', (await key(page, /^Control/).getAttribute('data-mod')) === 'locked');
  await page.keyboard.type('e'); await sleep(100); await page.keyboard.type('f'); await sleep(100);
  await press(page, /^Control/);
  check('tap releases a locked ctrl', (await key(page, /^Control/).getAttribute('data-mod')) === null);
  await page.keyboard.type('g'); await sleep(100);
  await press(page, /^Enter$/); await sleep(300);
  out = pane(S);
  const line2 = out.split('\n').filter((l) => l.includes('^A')).pop() || '';
  check('modifiers apply to typed keys and to bar keys', line2.includes('^Ab^[x^[[1;5A^[/^E^Fg'), JSON.stringify(line2));

  await press(page, /^Interrupt/); await sleep(400);
  await page.keyboard.type('echo after-$((1+1))-int\n'); await sleep(500);
  check('^C interrupts the foreground program', pane(S).includes('after-2-int'));

  // --- composer ------------------------------------------------------------------
  await press(page, /^Compose/); await sleep(250);
  check('composer takes focus when opened', await page.evaluate(() => document.activeElement?.classList.contains('composer-input') ?? false));
  await page.keyboard.type('echo composed-$((20+3))');
  await page.getByRole('button', { name: 'Send and press Enter' }).tap(); await sleep(700);
  check('composer sends text and Enter', pane(S).includes('composed-23'));
  await page.keyboard.type('echo inserted-only');
  await page.getByRole('button', { name: 'Insert' }).tap(); await sleep(500);
  const last = pane(S).trimEnd().split('\n').pop() || '';
  check('composer "Insert" types without running', last.includes('echo inserted-only') && !pane(S).includes('\ninserted-only'), JSON.stringify(last));
  await press(page, /^Interrupt/); await sleep(200);
  await press(page, /^Compose/); await sleep(250);
  check('closing the composer hands focus to the terminal', await activeIsTerm(page));

  // --- select overlay --------------------------------------------------------------
  await press(page, /^Copy/); await sleep(350);
  const overlay = await page.locator('.select-overlay-text').textContent().catch(() => null);
  check('select mode shows the buffer as text', !!overlay && overlay.includes('composed-23'));
  await page.getByRole('button', { name: 'Done' }).tap(); await sleep(250);
  check('select mode closes', (await page.locator('.select-overlay').count()) === 0);

  // --- resize ------------------------------------------------------------------------
  await page.setViewportSize({ width: 844, height: 390 }); await sleep(900);
  const cWide = cols(S);
  check('rotating to landscape widens the tmux window', cWide > c0 + 30, `${c0} -> ${cWide} cols`);
  await page.setViewportSize(PHONE); await sleep(900);
  check('rotating back restores the width', cols(S) === c0, `${cols(S)} cols`);
  // Text size, through the real control in Settings.
  await page.getByRole('button', { name: 'Session menu and settings' }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Smaller text' }).tap(); await sleep(150);
  await page.getByRole('button', { name: 'Smaller text' }).tap(); await sleep(900);
  const cSmall = cols(S);
  check('smaller text size gives more columns (live, sheet still open)', cSmall > c0, `${c0} -> ${cSmall} cols at 11px`);
  await page.getByRole('button', { name: 'Larger text' }).tap(); await sleep(150);
  await page.getByRole('button', { name: 'Larger text' }).tap(); await sleep(700);
  check('restoring the text size restores the width', cols(S) === c0, `${cols(S)} cols`);
  await page.getByRole('tab', { name: 'Light' }).tap(); await sleep(400);
  const light = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, term: getComputedStyle(document.querySelector('.terminal-inner')).backgroundColor, meta: document.querySelector('meta[name=theme-color]').content }));
  check('theme switch applies live to app, terminal and browser chrome', light.theme === 'light' && light.term === 'rgb(251, 249, 244)' && light.meta === '#f5f2eb', JSON.stringify(light));
  await page.getByRole('switch', { name: 'Keep terminal dark' }).tap(); await sleep(300);
  check('"keep terminal dark" keeps the terminal on the dark palette', await page.evaluate(() => getComputedStyle(document.querySelector('.terminal-inner')).backgroundColor === 'rgb(20, 19, 18)'));
  await page.getByRole('switch', { name: 'Keep terminal dark' }).tap(); await sleep(150);
  await page.getByRole('tab', { name: 'Dark' }).tap(); await sleep(300);
  await page.getByRole('button', { name: 'Close' }).tap(); await sleep(400);

  // tmux prefix key: ^B then c opens a second window.
  await tapTerm(page);
  await press(page, /^Ctrl\+B/); await page.keyboard.type('c'); await sleep(700);
  check('^B reaches tmux as its prefix', tmux('display-message', '-p', '-t', `=${S}:`, '#{session_windows}') === '2');

  // --- keyboard-open geometry ------------------------------------------------------------
  await tapTerm(page);
  await page.setViewportSize({ width: 390, height: 508 }); await sleep(800);
  const geo = await page.evaluate(() => {
    const bar = document.querySelector('.keybar').getBoundingClientRect();
    return { kb: document.documentElement.dataset.kb, barBottom: Math.round(bar.bottom), vh: window.innerHeight, appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h') };
  });
  check('keyboard-open state detected and key bar sits on the keyboard edge', geo.kb === 'open' && geo.barBottom === 508, JSON.stringify(geo));
  await page.setViewportSize(PHONE); await sleep(600);
  check('keyboard-closed state restored', await page.evaluate(() => document.documentElement.dataset.kb === undefined));

  // --- back to the list, create + kill from the UI -------------------------------------------
  await page.getByRole('button', { name: 'Back to sessions' }).tap(); await sleep(900);
  check('back returns to the session list', await page.getByRole('tab', { name: 'Sessions' }).isVisible());
  check('list shows the session', await page.getByText(S, { exact: true }).isVisible());
  await page.getByRole('button', { name: 'New session', exact: true }).tap(); await sleep(400);
  await page.keyboard.type('verify 2!'); await sleep(150);
  await page.getByRole('button', { name: /^Create/ }).tap(); await sleep(2200);
  check('new session is created (name sanitised) and opened', tmuxOk('has-session', '-t', '=verify2') && page.url().includes('session=verify2'), page.url());
  await page.getByRole('button', { name: 'Session menu and settings' }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Kill' }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(2800);
  check('kill from the terminal menu removes the session and does not re-create it', !tmuxOk('has-session', '-t', '=verify2'));
  await page.getByRole('button', { name: `Actions for ${S}` }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(400);
  await page.getByRole('button', { name: 'Kill session' }).tap(); await sleep(1500);
  check('kill from the list removes the session', !tmuxOk('has-session', '-t', `=${S}`));

  await context.close();
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
