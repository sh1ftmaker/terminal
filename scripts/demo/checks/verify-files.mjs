// Files tab, write paths included — only inside the demo workspace (admin
// context, the repo's own demo-workspace/ directory).
import { withBrowser, newPhone, sleep, REPO } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const WS = path.join(REPO, 'demo-workspace/');
const BASE = (process.env.BASE || 'http://localhost:3102').replace(/\/$/, '');
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const DIR = path.join(WS, 'verify-files');
fs.rmSync(DIR, { recursive: true, force: true });
fs.writeFileSync('/tmp/bt-fable-upload.txt', 'uploaded by the files check\n');

await withBrowser(async (browser) => {
  const { context, page } = await newPhone(browser, { scheme: 'dark' });
  await page.goto(`${BASE}/?session=scratch&context=admin`); await sleep(2000);
  await page.getByRole('tab', { name: 'Files' }).tap(); await sleep(1500);
  const crumbs = await page.locator('[aria-label="Current folder"]').textContent();
  check('opens in the session folder with a breadcrumb', /demo-workspace/.test(crumbs), crumbs);

  await page.getByRole('button', { name: 'New folder' }).tap(); await sleep(300);
  await page.keyboard.type('verify-files'); await page.keyboard.press('Enter'); await sleep(900);
  check('new folder is created', fs.existsSync(DIR));
  await page.getByText('verify-files', { exact: true }).tap(); await sleep(800);
  check('navigates into it', /verify-files/.test(await page.locator('[aria-label="Current folder"]').textContent()));
  check('empty folder state', /This folder is empty/.test(await page.locator('.screen').last().textContent()));

  await page.getByRole('button', { name: 'New file' }).tap(); await sleep(300);
  await page.keyboard.type('note.md'); await page.keyboard.press('Enter'); await sleep(900);
  check('new file is created', fs.existsSync(path.join(DIR, 'note.md')));

  await page.locator('input[type=file]').setInputFiles('/tmp/bt-fable-upload.txt'); await sleep(1500);
  check('upload lands in the folder', fs.existsSync(path.join(DIR, 'bt-fable-upload.txt')) && fs.readFileSync(path.join(DIR, 'bt-fable-upload.txt'), 'utf-8').includes('uploaded by'));
  check('upload panel reports it', /Uploaded 1 file/.test(await page.locator('.screen').last().textContent()));
  await page.getByRole('button', { name: 'Dismiss' }).tap(); await sleep(300);

  await page.getByText('note.md').tap(); await sleep(1200);
  await page.getByRole('button', { name: 'Edit file' }).tap(); await sleep(400);
  await page.keyboard.type('# saved from the phone UI');
  await page.getByRole('button', { name: 'Save' }).tap(); await sleep(900);
  check('edit + save writes the file', fs.readFileSync(path.join(DIR, 'note.md'), 'utf-8').includes('# saved from the phone UI'));
  await page.getByRole('button', { name: 'Edit file' }).tap(); await sleep(300);
  await page.keyboard.type('x');
  await page.getByRole('button', { name: 'Stop editing' }).tap(); await sleep(400);
  check('leaving with unsaved edits asks first', /Discard your changes/.test(await page.locator('.sheet').textContent().catch(() => '')));
  await page.getByRole('button', { name: 'Discard changes' }).tap(); await sleep(400);
  check('discard keeps the saved content', !fs.readFileSync(path.join(DIR, 'note.md'), 'utf-8').includes('x#') && (await page.locator('.code-view').count()) === 1);
  await page.getByRole('button', { name: 'Back to files' }).tap(); await sleep(500);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.getByRole('button', { name: 'Zip' }).tap(),
  ]);
  check('zip download starts', !!download && /verify-files\.zip/.test(download.suggestedFilename()), download ? download.suggestedFilename() : 'no download event');

  await page.getByRole('button', { name: 'Up one folder' }).tap(); await sleep(800);
  check('up returns to the parent', /verify-files/.test(await page.locator('.screen ul').last().textContent()));
  await page.getByText('assets', { exact: true }).tap(); await sleep(700);
  await page.getByText('icon.png').tap(); await sleep(1200);
  check('image preview loads', await page.locator('img[alt="icon.png"]').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false));
  await context.close();
});
fs.rmSync(DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
