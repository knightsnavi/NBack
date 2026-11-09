// Generates Android launcher icons (legacy + adaptive), the notification
// small icon, and splash screens from www/assets/icon.svg with the bundled Chromium.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(rootDir, 'android/app/src/main/res');
const svg = readFileSync(path.join(rootDir, 'www/assets/icon.svg'), 'utf8');
// Foreground-only variant: the same artwork without the rounded background plate.
const fgSvg = svg.replace(/<rect width="512" height="512" rx="112" fill="url\(#bg\)"\/>/, '');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const browser = await chromium.launch();
const page = await browser.newPage();

async function renderSvg(markup, size, file, { pad = 0, bg = 'transparent' } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await page.setContent(`<html><body style="margin:0;background:${bg};width:${size}px;height:${size}px;display:grid;place-items:center">
    <div style="width:${inner}px;height:${inner}px">${markup.replace(/width="512" height="512"/, `width="${inner}" height="${inner}"`)}</div></body></html>`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [name, scale] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${name}`);
  await renderSvg(svg, Math.round(48 * scale), path.join(dir, 'ic_launcher.png'));
  await renderSvg(svg, Math.round(48 * scale), path.join(dir, 'ic_launcher_round.png'));
  // adaptive foreground: 108dp canvas, artwork inside the 66dp safe zone
  const full = Math.round(108 * scale);
  await renderSvg(fgSvg, full, path.join(dir, 'ic_launcher_foreground.png'), { pad: Math.round(full * 0.19) });
}
// adaptive icon xml + background colour
mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive);
writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive);
mkdirSync(path.join(res, 'values'), { recursive: true });
writeFileSync(path.join(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#7C5CFF</color>
</resources>
`);

// notification small icon: white glyph on transparent (Android tints it)
const statSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <g fill="#ffffff"><rect x="60" y="60" width="110" height="110" rx="28"/><rect x="201" y="60" width="110" height="110" rx="28"/><rect x="342" y="60" width="110" height="110" rx="28"/>
  <rect x="60" y="201" width="110" height="110" rx="28"/><rect x="342" y="201" width="110" height="110" rx="28"/>
  <rect x="60" y="342" width="110" height="110" rx="28"/><rect x="201" y="342" width="110" height="110" rx="28"/><rect x="342" y="342" width="110" height="110" rx="28"/></g>
</svg>`;
for (const [name, scale] of Object.entries(densities)) {
  await renderSvg(statSvg, Math.round(24 * scale), path.join(res, `drawable-${name}`, 'ic_stat_nback.png'));
}

// splash screens: icon centred on the brand gradient
async function splash(w, h, file) {
  await page.setViewportSize({ width: w, height: h });
  const size = Math.round(Math.min(w, h) * 0.28);
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:linear-gradient(160deg,#7c5cff,#ff6b8b);display:grid;place-items:center">
    <div style="width:${size}px;height:${size}px;filter:drop-shadow(0 20px 40px rgba(0,0,0,.25))">${svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</div></body></html>`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
}
await splash(1080, 1920, path.join(res, 'drawable/splash.png'));
await splash(480, 800, path.join(res, 'drawable-port-mdpi/splash.png'));
await splash(800, 1280, path.join(res, 'drawable-port-hdpi/splash.png'));
await splash(1080, 1920, path.join(res, 'drawable-port-xhdpi/splash.png'));
await splash(1440, 2560, path.join(res, 'drawable-port-xxhdpi/splash.png'));
await splash(1440, 2560, path.join(res, 'drawable-port-xxxhdpi/splash.png'));
await splash(800, 480, path.join(res, 'drawable-land-mdpi/splash.png'));
await splash(1280, 800, path.join(res, 'drawable-land-hdpi/splash.png'));
await splash(1920, 1080, path.join(res, 'drawable-land-xhdpi/splash.png'));
await splash(2560, 1440, path.join(res, 'drawable-land-xxhdpi/splash.png'));
await splash(2560, 1440, path.join(res, 'drawable-land-xxxhdpi/splash.png'));
await browser.close();
console.log('android icons and splash written');
