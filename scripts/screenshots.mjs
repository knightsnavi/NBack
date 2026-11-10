// Screenshot gallery: walks the main screens on Galaxy Z Fold-sized viewports
// and writes PNGs to ./screenshots (git-ignored). Behaviour is asserted by
// tests/e2e.mjs; this script is for looking at the result.
//
//   npm start                      # serves www/ on :8080
//   node scripts/screenshots.mjs   # ONLY=cover,tabletop  DARK=1  SCALE=2
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'screenshots');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const SCALE = Number(process.env.SCALE || 1);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

// Galaxy Z Fold, CSS px (approximate). Half-open postures use the app's URL
// override because headless Chromium does not expose the fold APIs.
const VIEWPORTS = {
  cover: { width: 400, height: 940 },
  inner: { width: 757, height: 840 },
  innerLandscape: { width: 840, height: 757 },
  tabletop: { width: 840, height: 757, query: '?posture=tabletop&hinge=28' },
  book: { width: 840, height: 757, query: '?posture=book&hinge=28' },
};

function sampleHistory() {
  const out = [];
  const now = Date.now();
  const per = a => ({ hits: Math.round(6 * a), misses: 6 - Math.round(6 * a), falseAlarms: 1, correctRejections: 13, targets: 6, accuracy: a, errors: 7 - Math.round(6 * a), meanRt: 520 + Math.round(a * 200) });
  for (let d = 30; d >= 0; d--) {
    if (d % 6 === 4) continue; // a rest day now and then
    const n = d > 20 ? 1 : d > 9 ? 2 : 3;
    const a = 0.62 + ((d * 7) % 5) * 0.07;
    out.push({ ts: now - d * 86400000 - 7200000, n, nextN: n, mode: 'dual', length: 'standard', trials: 20 + n, interval: 3000, durationMs: (20 + n) * 3000, accuracy: a, errors: 4, meanRt: 640, perStream: { position: per(Math.min(1, a + 0.08)), sound: per(a - 0.05) } });
    if (d % 3 === 0) out.push({ ts: now - d * 86400000 - 3600000, n: 2, nextN: 2, mode: 'position', length: 'standard', trials: 22, interval: 3000, durationMs: 66000, accuracy: 0.9, errors: 1, meanRt: 480, perStream: { position: per(0.9) } });
  }
  return out;
}

const QUIET = { tutorialVoice: false, sound: false, tones: false };
const SEED = {
  'nback.onboarded.v1': 'true',
  'nback.history.v1': sampleHistory(),
  'nback.meta.v1': { watchedVideo: true },
  'nback.achievements.v1': { first: Date.now(), n3: Date.now(), streak3: Date.now(), s10: Date.now() },
  'nback.settings.v1': { ...QUIET, mode: 'dual', levels: { dual: 3, position: 2 } },
};

const errors = [];
const browser = await chromium.launch();
const tap = (page, sel) => page.dispatchEvent(sel, 'pointerdown', { button: 0, pointerType: 'touch', bubbles: true });

async function open(name, seed) {
  const vp = VIEWPORTS[name];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  await page.addInitScript((data) => { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, seed);
  await page.goto(BASE + (vp.query || ''));
  await page.waitForSelector('#app');
  await page.waitForTimeout(250);
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('  shot', name);
}

for (const name of Object.keys(VIEWPORTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(name);

  // home, progress, settings
  let page = await open(name, SEED);
  await shot(page, `${name}-home`);
  await page.click('#nav-stats');
  await page.waitForTimeout(500);
  await shot(page, `${name}-progress`);
  await page.click('#btn-back');
  await page.click('#nav-settings');
  await page.waitForTimeout(200);
  await shot(page, `${name}-settings`);
  await page.context().close();

  // play: a lit square, a correct press, and the pause overlay
  page = await open(name, { ...SEED, 'nback.settings.v1': { ...QUIET, mode: 'position', levels: { position: 1 }, stimulusMs: 1500 } });
  await page.click('#btn-start');
  await page.waitForSelector('.cell.lit', { timeout: 8000 });
  await shot(page, `${name}-play`);
  // wait for an item that repeats the previous square, then press Position for the green feedback
  const pressed = await page.evaluate(() => new Promise((resolve) => {
    const seen = [];
    const on = new Set();
    const giveUp = setTimeout(() => resolve(false), 45000);
    new MutationObserver((records) => {
      for (const el of new Set(records.map(m => m.target))) {
        if (!el.classList.contains('lit')) { on.delete(el); continue; }
        if (on.has(el)) continue;
        on.add(el);
        seen.push(el.dataset.index);
        if (seen.length > 1 && seen[seen.length - 2] === el.dataset.index) { clearTimeout(giveUp); resolve(true); }
      }
    }).observe(document.querySelector('#board'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  })).catch(() => false);
  if (pressed) {
    await tap(page, '#btn-position');
    await page.waitForTimeout(120);
    await shot(page, `${name}-play-correct`);
  }
  await page.click('#btn-pause');
  await page.waitForTimeout(200);
  await shot(page, `${name}-paused`);
  await page.context().close();

  // tutorial: the 2-back comparison step
  page = await open(name, { 'nback.settings.v1': QUIET });
  await page.waitForSelector('#dlg-welcome[open]', { timeout: 4000 });
  if (name === 'cover') await shot(page, `${name}-welcome`);
  await page.click('#dlg-welcome button[value="tutorial"]');
  await page.waitForSelector('#coach:not([hidden])');
  for (let guard = 0; guard < 120; guard++) {
    if ((await page.textContent('#coach-title')) === 'Look two back') break;
    const cue = await page.$$eval('.action.cue', els => els.map(e => e.dataset.stream));
    if (cue.length) { await tap(page, `.action[data-stream="${cue[0]}"]`); await page.waitForTimeout(200); continue; }
    if (await page.isVisible('#coach-next')) { await page.click('#coach-next'); await page.waitForTimeout(450); continue; }
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  await shot(page, `${name}-tutorial`);
  await page.context().close();
}

// results, after a short real session with a few presses
if (!ONLY || ONLY.includes('cover')) {
  console.log('results');
  const page = await open('cover', { ...SEED, 'nback.settings.v1': { ...QUIET, mode: 'dual', length: 'short', interval: 1500, stimulusMs: 300, levels: { dual: 2 } } });
  await page.click('#btn-start');
  await page.waitForFunction(() => document.querySelector('#app').dataset.screen === 'play' && document.querySelector('#hud-count').textContent === '', null, { timeout: 15000 });
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(2600); await tap(page, i % 2 ? '#btn-sound' : '#btn-position'); }
  await page.waitForFunction(() => document.querySelector('#app').dataset.screen === 'results', null, { timeout: 40000 });
  await page.waitForTimeout(800);
  await shot(page, 'cover-results');
  await page.context().close();
}

await browser.close();
if (errors.length) {
  console.log('\nCONSOLE ERRORS:');
  for (const e of errors) console.log(' ', e);
  process.exit(1);
}
console.log('\nno console errors');
