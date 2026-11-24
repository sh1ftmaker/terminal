// Rasterise the app icon set from one drawing.
import { withBrowser, REPO } from './lib.mjs';
import fs from 'fs';
const PUB = `${REPO}frontend/public/`;
// glyph: prompt chevron + cursor block, drawn on a 512 grid
const glyph = (scale = 1) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <path d="M158 176l92 80-92 80" fill="none" stroke="#f5a04a" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="274" y="313" width="92" height="46" rx="12" fill="#ece7df"/></g>`;
const defs = `<defs><radialGradient id="g" cx="0.3" cy="0.22" r="0.95"><stop offset="0" stop-color="#2a2521"/><stop offset="1" stop-color="#141312"/></radialGradient></defs>`;
const svg = (rx, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${defs}<rect width="512" height="512" rx="${rx}" fill="url(#g)"/>${glyph(scale)}</svg>`;
const targets = [
  { file: 'icon-192.png', size: 192, rx: 114, scale: 1 },
  { file: 'icon-512.png', size: 512, rx: 114, scale: 1 },
  // maskable: full bleed, artwork inside the central safe zone
  { file: 'icon-512-maskable.png', size: 512, rx: 0, scale: 0.78 },
  // iOS masks the corners itself and wants no transparency
  { file: 'apple-touch-icon.png', size: 180, rx: 0, scale: 0.92 },
];
await withBrowser(async (browser) => {
  for (const t of targets) {
    const context = await browser.newContext({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0;background:transparent">${svg(t.rx, t.scale)}</body>`);
    await page.screenshot({ path: PUB + t.file, omitBackground: true });
    await context.close();
    console.log(t.file, fs.statSync(PUB + t.file).size);
  }
});
