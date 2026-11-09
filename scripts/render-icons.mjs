// Renders PNG icons from assets/icon.svg with the bundled Chromium.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(rootDir, 'assets/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? `<div style="width:${size}px;height:${size}px;background:#7c5cff;display:grid;place-items:center"><div style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px">${svg}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html>`);
  await page.locator('svg').first().evaluate((el, s) => { el.setAttribute('width', s); el.setAttribute('height', s); }, maskable ? Math.round(size * 0.8) : size);
  await page.screenshot({ path: path.join(rootDir, 'assets', file), omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { maskable: true });
await render(96, 'badge.png');
await browser.close();
