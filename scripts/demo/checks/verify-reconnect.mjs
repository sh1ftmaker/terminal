// Reconnect flow: restart the demo server under an attached terminal.
import { withBrowser, newPhone, sleep, REPO } from './lib.mjs';
import { execFileSync, execSync } from 'child_process';
const SOCK = '/tmp/bt-fable-tmux.sock';
const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
const tmux = (...a) => execFileSync('tmux', ['-S', SOCK, ...a], { env, encoding: 'utf-8' }).trim();
const pane = (s) => tmux('capture-pane', '-p', '-J', '-t', `=${s}:`);
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const S = 'verify-rc';
try { tmux('kill-session', '-t', `=${S}`); } catch {}

await withBrowser(async (browser) => {
  const { context, page } = await newPhone(browser, { scheme: 'dark' });
  await page.goto(`http://localhost:3102/?session=${S}`);
  await sleep(2500);
  const v = page.viewportSize();
  await page.touchscreen.tap(v.width / 2, v.height * 0.4); await sleep(300);
  await page.keyboard.type('echo before-$((1+1))\n'); await sleep(500);
  check('attached and typing before the restart', pane(S).includes('before-2'));
  check('no banner while connected', (await page.locator('.conn-banner').count()) === 0);

  execSync('sbg stop bt-fable', { cwd: REPO, stdio: 'ignore' });
  await sleep(1500);
  const banner = await page.locator('.conn-banner').textContent().catch(() => null);
  check('banner appears when the connection drops', !!banner && /Reconnecting/.test(banner), JSON.stringify(banner));
  check('header status reflects it', /Reconnecting|Connecting/.test(await page.locator('header').textContent()));
  check('session survives the server restart', (() => { try { tmux('has-session', '-t', `=${S}`); return true; } catch { return false; } })());

  execSync('sbg start bt-fable -- ./scripts/demo/run-server.sh', { cwd: REPO, stdio: 'ignore' });
  let back = false;
  for (let i = 0; i < 20 && !back; i++) { await sleep(500); back = (await page.locator('.conn-banner').count()) === 0; }
  check('reconnects by itself once the server is back', back);
  await sleep(600);
  await page.keyboard.type('echo after-$((2+2))\n'); await sleep(700);
  const p = pane(S);
  check('typing works again after reconnect', p.includes('after-4'));
  check('earlier output is still there', p.includes('before-2'));

  // Manual retry path: kill the socket from the page side, press Retry.
  execSync('sbg stop bt-fable', { cwd: REPO, stdio: 'ignore' });
  await sleep(1200);
  execSync('sbg start bt-fable -- ./scripts/demo/run-server.sh', { cwd: REPO, stdio: 'ignore' });
  await sleep(900);
  const retry = page.getByRole('button', { name: 'Retry' });
  if (await retry.count()) await retry.tap();
  let back2 = false;
  for (let i = 0; i < 12 && !back2; i++) { await sleep(400); back2 = (await page.locator('.conn-banner').count()) === 0; }
  check('Retry button reconnects', back2);

  await page.getByRole('button', { name: 'Back to sessions' }).tap(); await sleep(600);
  await context.close();
});
try { tmux('kill-session', '-t', `=${S}`); } catch {}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
