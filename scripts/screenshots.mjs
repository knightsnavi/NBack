// Drives the app through its screens on Galaxy Z Fold-sized viewports and
// writes screenshots to ./screenshots. Also fails on any console error.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'screenshots');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
// the local server must serve the www/ folder: npm start
const SCALE = Number(process.env.SCALE || 1);

// Galaxy Z Fold (CSS px, approx): cover 360x880, inner 725x870
const VIEWPORTS = {
  cover: { width: 360, height: 880 },
  inner: { width: 725, height: 870 },
  innerLandscape: { width: 870, height: 725 },
  fold8inner: { width: 840, height: 757 },
  fold8cover: { width: 400, height: 940 },
  tabletop: { width: 870, height: 725, feature: { orientation: 'horizontal', offset: 349, maskLength: 28 } },
  book: { width: 725, height: 870, feature: { orientation: 'vertical', offset: 349, maskLength: 28 } },
};

function fakeHistory() {
  const out = [];
  const now = Date.now();
  let n = 2;
  for (let day = 34; day >= 0; day--) {
    if (day % 5 === 3) continue; // a rest day now and then
    const sessions = 1 + ((day * 7) % 4);
    for (let k = 0; k < sessions; k++) {
      const ts = now - day * 86400000 - (5 - k) * 1800000;
      const acc = 0.55 + Math.random() * 0.4;
      const errors = Math.round((1 - acc) * 14);
      const nextN = errors < 3 ? Math.min(6, n + 1) : errors > 5 ? Math.max(1, n - 1) : n;
      const mode = day % 9 === 0 ? 'triple' : 'dual';
      const per = (a) => ({ hits: Math.round(6 * a), misses: 6 - Math.round(6 * a), falseAlarms: Math.round((1 - a) * 3), correctRejections: 11, targets: 6, accuracy: a, errors: 6 - Math.round(6 * a) + Math.round((1 - a) * 3), meanRt: 500 + Math.round(Math.random() * 400) });
      const perStream = { position: per(Math.min(1, acc + 0.05)), sound: per(Math.max(0, acc - 0.08)) };
      if (mode === 'triple') perStream.color = per(acc);
      out.push({ ts, n, nextN, mode, length: 'standard', trials: 20 + n, interval: 3000, durationMs: (20 + n) * 3000, accuracy: acc, errors, meanRt: 650, perStream });
      n = nextN;
    }
  }
  return out;
}

const errors = [];
const browser = await chromium.launch({ args: ['--enable-experimental-web-platform-features'] });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : (process.env.TUTORIAL ? [] : null);

async function openPage(vpName, { seed = true, query = '' } = {}) {
  const vp = VIEWPORTS[vpName];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${vpName}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${vpName}] ${e.message}`));
  await page.addInitScript(({ history, seedData }) => {
    if (seedData) {
      localStorage.setItem('nback.history.v1', JSON.stringify(history));
      localStorage.setItem('nback.onboarded.v1', 'true');
      localStorage.setItem('nback.achievements.v1', JSON.stringify({ first: Date.now(), n3: Date.now(), streak3: Date.now(), s10: Date.now() }));
    }
  }, { history: fakeHistory(), seedData: seed });
  let hingeQuery = '';
  if (vp.feature) {
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Emulation.setDisplayFeaturesOverride', { features: [vp.feature] });
    } catch (e) {
      // Older Chromium: fall back to the URL override the app supports
      hingeQuery = `posture=${vp.feature.orientation === 'horizontal' ? 'tabletop' : 'book'}&hinge=${vp.feature.maskLength}`;
      console.log(`  (CDP display features unavailable, using URL override: ${e.message.split('\n')[0]})`);
    }
  }
  let q = [query, hingeQuery].filter(Boolean).join('&');
  await page.goto(BASE + (q ? `?${q}` : ''));
  await page.waitForSelector('#app');
  await page.waitForTimeout(250);
  if (vp.feature && !hingeQuery) {
    const detected = await page.evaluate(() => document.documentElement.dataset.posture);
    const segs = await page.evaluate(() => (window.visualViewport && window.visualViewport.segments ? window.visualViewport.segments.length : 'none'));
    console.log(`  viewport segments via API: ${segs}`);
    if (detected === 'single') {
      hingeQuery = `posture=${vp.feature.orientation === 'horizontal' ? 'tabletop' : 'book'}&hinge=${vp.feature.maskLength}`;
      q = [query, hingeQuery].filter(Boolean).join('&');
      console.log('  falling back to URL override');
      await page.goto(BASE + `?${q}`);
      await page.waitForSelector('#app');
      await page.waitForTimeout(250);
    }
  }
  return { page, context };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('  shot', name);
}

for (const vpName of Object.keys(VIEWPORTS)) {
  if (ONLY && !ONLY.includes(vpName)) continue;
  console.log(vpName);
  const { page, context } = await openPage(vpName);
  const posture = await page.evaluate(() => document.documentElement.dataset.posture + '/' + document.documentElement.dataset.layout + '/' + document.documentElement.dataset.width);
  console.log('  posture:', posture);
  await shot(page, `${vpName}-home`);

  // play: start and capture a lit cell during the first trials
  await page.click('#btn-start');
  await page.waitForSelector('.cell.lit', { timeout: 8000 });
  await shot(page, `${vpName}-play`);
  // press a button to show feedback, then pause
  await page.waitForTimeout(3200);
  await page.dispatchEvent('#btn-position', 'pointerdown', { button: 0, pointerType: 'touch' });
  await page.waitForTimeout(120);
  await shot(page, `${vpName}-play-feedback`);
  await page.click('#btn-pause');
  await page.waitForTimeout(200);
  await shot(page, `${vpName}-paused`);
  // end session
  await page.click('#btn-quit');
  await page.waitForSelector('#dlg-confirm[open]');
  await page.click('#confirm-ok');
  await page.waitForTimeout(200);

  await page.click('#nav-stats');
  await page.waitForTimeout(400);
  await shot(page, `${vpName}-stats`);
  await page.click('#btn-back');
  await page.click('#nav-settings');
  await page.waitForTimeout(200);
  await shot(page, `${vpName}-settings`);
  await context.close();
}

// Full short session on the cover screen to reach the results view.
if (!ONLY) {
  console.log('results run');
  const { page, context } = await openPage('cover');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('nback.settings.v1') || '{}');
    Object.assign(s, { interval: 900, stimulusMs: 300, length: 'short', n: 1, mode: 'dual', sound: false });
    localStorage.setItem('nback.settings.v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('#btn-start');
  await page.click('#btn-start');
  const start = Date.now();
  while (Date.now() - start < 40000) {
    const screen = await page.getAttribute('#app', 'data-screen');
    if (screen === 'results') break;
    if (Math.random() < 0.35) await page.dispatchEvent('#btn-position', 'pointerdown', { button: 0, pointerType: 'touch' });
    if (Math.random() < 0.35) await page.dispatchEvent('#btn-sound', 'pointerdown', { button: 0, pointerType: 'touch' });
    await page.waitForTimeout(450);
  }
  const screen = await page.getAttribute('#app', 'data-screen');
  console.log('  reached screen:', screen);
  await page.waitForTimeout(700);
  await shot(page, 'cover-results');
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('nback.history.v1')).slice(-1)[0]);
  console.log('  saved session:', JSON.stringify({ n: history.n, nextN: history.nextN, trials: history.trials, accuracy: +history.accuracy.toFixed(2), errors: history.errors, duration: history.durationMs }));
  await context.close();
}

// First run (no data): onboarding dialog
if (!ONLY) {
  const { page, context } = await openPage('cover', { seed: false });
  await page.waitForSelector('#dlg-welcome[open]', { timeout: 3000 });
  await shot(page, 'cover-firstrun');
  await context.close();
}

await browser.close();
if (errors.length && !process.env.TUTORIAL) {
  console.log('\nCONSOLE ERRORS:');
  for (const e of errors) console.log(' ', e);
  process.exit(1);
}
console.log('\nno console errors');

// Tutorial walk: first run → welcome → guided steps, pressing the hinted buttons.
export async function tutorialWalk(vpName) {
  const b = await chromium.launch({ args: ['--enable-experimental-web-platform-features'] });
  const errs = [];
  const vp = VIEWPORTS[vpName];
  const context = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(e.message));
  const narrated = new Set();
  page.on('request', r => { const m = r.url().match(/audio\/tutorial\/([a-z_]+)\.mp3/); if (m) narrated.add(m[1]); });
  const q = vp.feature ? `?posture=${vp.feature.orientation === 'horizontal' ? 'tabletop' : 'book'}&hinge=${vp.feature.maskLength}` : '';
  await page.goto(BASE + q);
  await page.waitForSelector('#dlg-welcome[open]', { timeout: 4000 });
  await shot(page, `${vpName}-welcome`);
  await page.click('#dlg-welcome button[value="tutorial"]');
  await page.waitForSelector('#coach:not([hidden])');
  await page.waitForTimeout(400);
  await shot(page, `${vpName}-tutorial-0`);
  const pressHinted = async () => {
    for (let k = 0; k < 3; k++) {
      const hinted = await page.$$eval('.action.hint', els => els.map(e => e.dataset.stream));
      if (!hinted.length) return;
      await page.dispatchEvent(`.action[data-stream="${hinted[0]}"]`, 'pointerdown', { button: 0, pointerType: 'touch' });
      await page.waitForTimeout(250);
    }
  };
  let guard = 0;
  while (guard++ < 140) {
    const title = await page.textContent('#coach-title');
    const nextVisible = await page.isVisible('#coach-next');
    if (title.startsWith('Practice done')) break;
    if (title.startsWith('Practice')) { await pressHinted(); await page.waitForTimeout(600); continue; }
    if (nextVisible) {
      if (guard === 3) await shot(page, `${vpName}-tutorial-step`);
      await page.click('#coach-next');
      await page.waitForTimeout(700);
    } else {
      await page.waitForTimeout(500);
      if (guard === 4) await shot(page, `${vpName}-tutorial-hint`);
      await pressHinted();
      await page.waitForTimeout(400);
    }
  }
  await shot(page, `${vpName}-tutorial-done`);
  await page.click('#coach-next');
  await page.waitForTimeout(400);
  const screen = await page.getAttribute('#app', 'data-screen');
  const onboarded = await page.evaluate(() => localStorage.getItem('nback.onboarded.v1'));
  console.log(`  tutorial finished → screen ${screen}, onboarded=${onboarded}, loops=${guard}`);
  console.log(`  narration lines requested (${narrated.size}): ${[...narrated].join(', ')}`);
  await b.close();
  if (errs.length) { console.log('CONSOLE ERRORS', errs); process.exit(1); }
}
if (process.env.TUTORIAL) {
  for (const v of process.env.TUTORIAL.split(',')) { console.log('tutorial on', v); await tutorialWalk(v); }
}
