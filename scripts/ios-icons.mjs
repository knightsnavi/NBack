// Generates the iOS app icon and launch image from www/assets/icon.svg with the bundled Chromium.
//   node scripts/ios-icons.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(rootDir, 'ios/App/App/Assets.xcassets');
const svg = readFileSync(path.join(rootDir, 'www/assets/icon.svg'), 'utf8');
// iOS rounds the corners itself, so the artwork fills the whole square.
const squareSvg = svg.replace('rx="112" fill="url(#bg)"', 'fill="url(#bg)"');
if (squareSvg === svg) throw new Error('icon.svg: background plate not found');

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(html, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px">${html}</body></html>`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size } });
}

// App icon: one 1024 px image; Xcode derives every other size.
await render(squareSvg.replace(/width="512" height="512"/, 'width="1024" height="1024"'), 1024, path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'));

// Launch image: the icon centred on the brand gradient. It is scaled to fill and cropped, so the
// icon stays small enough to survive the crop on a phone in portrait.
const S = 2732;
const icon = Math.round(S * 0.16);
const launch = `<div style="width:${S}px;height:${S}px;background:linear-gradient(160deg,#7c5cff,#ff6b8b);display:grid;place-items:center">
  <div style="width:${icon}px;height:${icon}px;filter:drop-shadow(0 20px 40px rgba(0,0,0,.25))">${svg.replace(/width="512" height="512"/, `width="${icon}" height="${icon}"`)}</div></div>`;
const first = path.join(assets, 'Splash.imageset/splash-2732x2732.png');
await render(launch, S, first);
for (const copy of ['splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(path.join(assets, 'Splash.imageset', copy), readFileSync(first));

await browser.close();
console.log('ios icon and launch image written');
