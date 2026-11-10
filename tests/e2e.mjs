// End-to-end checks against the real app in headless Chromium.
//   npm start            (serves www/ on :8080)
//   npm run e2e
// Exits non-zero on the first failed check or on any console error.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const COVER = { width: 400, height: 940 };
const errors = [];
let passed = 0;

const browser = await chromium.launch();

/** A fresh browser profile. `seed` is written to localStorage before the app boots. */
async function open(seed = {}, viewport = COVER, query = '') {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', (d) => { errors.push(`unexpected browser dialog: ${d.message()}`); d.dismiss(); });
  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, seed);
  await page.goto(BASE + query);
  await page.waitForSelector('#app');
  return page;
}

const ONBOARDED = { 'nback.onboarded.v1': 'true' };
// fastest pace the app allows, shortest block, one stream: a session takes about 25 s
const FAST = { ...ONBOARDED, 'nback.settings.v1': { mode: 'position', length: 'short', interval: 1500, stimulusMs: 300, sound: false, tones: false, tutorialVoice: false } };

const screen = page => page.getAttribute('#app', 'data-screen');
/** Dialog results arrive on a later task, so wait for the screen instead of sampling it. */
const waitScreen = (page, name, timeout = 5000) => page.waitForFunction(n => document.querySelector('#app').dataset.screen === n, name, { timeout });
const tap = (page, sel) => page.dispatchEvent(sel, 'pointerdown', { button: 0, pointerType: 'touch', bubbles: true });
const rect = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10).join(','); });
const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('nback.history.v1') || '[]'));
const settings = page => page.evaluate(() => JSON.parse(localStorage.getItem('nback.settings.v1') || '{}'));

/** Count every time a square lights up, from now on. */
async function countLights(page) {
  await page.evaluate(() => {
    window.__lit = [];
    if (window.__litObserver) return; // already watching: just reset the count
    const on = new Set(); // squares that are lit right now; a batch may hold several records for one square
    window.__litObserver = new MutationObserver((records) => {
      for (const el of new Set(records.map(m => m.target))) {
        const lit = el.classList.contains('lit');
        if (lit && !on.has(el)) { on.add(el); window.__lit.push(Number(el.dataset.index)); }
        if (!lit) on.delete(el);
      }
    });
    window.__litObserver.observe(document.querySelector('#board'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}
const lights = page => page.evaluate(() => window.__lit.slice());

/** Wait until the next square lights up (the lit window is short, so poll the event log, not visibility). */
async function waitForItem(page, timeout = 9000) {
  await countLights(page);
  await page.waitForFunction(() => window.__lit.length > 0, null, { timeout });
}

async function check(name, fn) {
  const before = errors.length;
  try {
    await fn();
    assert.deepEqual(errors.slice(before), [], 'console errors during this check');
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`);
    await browser.close();
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
await check('first launch offers the tutorial; skipping lands on a 1-back home', async () => {
  const page = await open();
  await page.waitForSelector('#dlg-welcome[open]', { timeout: 3000 });
  await page.click('#dlg-welcome button[value="skip"]');
  assert.equal(await screen(page), 'home');
  assert.equal(await page.textContent('#level-n'), '1');
  assert.match(await page.textContent('#start-meta'), /Dual · 1-back · 21 items/);
  assert.equal(await page.isVisible('#board'), false, 'the idle grid is not shown on the cover-screen home');
  assert.equal(await page.isVisible('#btn-video-home'), true);
  await page.context().close();
});

await check('double-tapping Start runs exactly one session', async () => {
  const page = await open(FAST);
  await countLights(page);
  await page.evaluate(() => { const b = document.querySelector('#btn-start'); b.click(); b.click(); b.click(); });
  await page.waitForFunction(() => document.querySelector('#app').dataset.screen === 'results', null, { timeout: 45000 });
  assert.equal((await lights(page)).length, 16, 'one square per item: 15 + N items at 1-back');
  assert.equal((await history(page)).length, 1);
  await page.context().close();
});

await check('the opening countdown can be cancelled with X, and Start still works afterwards', async () => {
  const page = await open(FAST);
  await page.click('#btn-start');
  await page.waitForSelector('#countdown:not([hidden])');
  await page.click('#btn-quit');
  assert.equal(await screen(page), 'home');
  assert.equal(await page.isVisible('#dlg-confirm'), false, 'no confirmation needed before the session has begun');
  await countLights(page);
  await page.waitForTimeout(3500);
  assert.equal((await lights(page)).length, 0, 'the cancelled countdown never starts a session');
  assert.equal(await page.isDisabled('#btn-start'), false);
  await page.click('#btn-start');
  await waitForItem(page);
  await page.context().close();
});

await check('leaving the app during the countdown cancels the start', async () => {
  const page = await open(FAST);
  await countLights(page);
  await page.click('#btn-start');
  await page.waitForSelector('#countdown:not([hidden])');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await screen(page), 'home');
  await page.waitForTimeout(3500);
  assert.equal((await lights(page)).length, 0);
  await page.context().close();
});

await check('pause, cancel-quit, resume, then quit for real', async () => {
  const page = await open(FAST);
  await page.click('#btn-start');
  await waitForItem(page);
  await page.click('#btn-pause');
  assert.equal(await page.isVisible('#board-overlay'), true);
  await countLights(page);
  await page.waitForTimeout(2500);
  assert.equal((await lights(page)).length, 0, 'nothing is presented while paused');
  // X while paused asks first; Cancel keeps the session paused
  await page.click('#btn-quit');
  await page.waitForSelector('#dlg-confirm[open]');
  await page.click('#dlg-confirm button[value="cancel"]');
  await page.waitForTimeout(300);
  assert.equal(await screen(page), 'play');
  assert.equal(await page.isVisible('#board-overlay'), true);
  // resume replays the current item after a countdown
  await page.click('#btn-resume');
  await waitForItem(page);
  // X while running pauses and asks; confirming ends without recording
  await page.click('#btn-quit');
  await page.waitForSelector('#dlg-confirm[open]');
  await page.click('#confirm-ok');
  await waitScreen(page, 'home');
  assert.equal((await history(page)).length, 0);
  await page.context().close();
});

await check('a screen-reader style click (no touch event) presses a zone', async () => {
  const page = await open(FAST);
  await page.click('#btn-start');
  await waitForItem(page);
  await page.evaluate(() => document.querySelector('#btn-position').click());
  assert.equal(await page.$eval('#btn-position', el => el.classList.contains('pressed')), true);
  // a real touch fires pointerdown and then click: it must count once, not twice
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const b = document.querySelector('#btn-position');
    window.__pressed = 0;
    new MutationObserver(() => { if (b.classList.contains('pressed')) window.__pressed++; }).observe(b, { attributes: true, attributeFilter: ['class'] });
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0 }));
    b.click();
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__pressed), 1);
  await page.context().close();
});

await check('a perfect Position game levels up Position only; the grid and zones never change size', async () => {
  const page = await open(FAST);
  await page.click('#btn-start');
  await page.waitForSelector('#countdown:not([hidden])');
  const boardBefore = await rect(page, '#board');
  const cellBefore = await rect(page, '.cell[data-index="0"]');
  const zoneBefore = await rect(page, '#btn-position');
  // a bot that plays perfectly: press Position when the square equals the one N back
  await page.evaluate(() => {
    const n = 1;
    const seen = [];
    window.__sizes = new Set();
    const snap = () => {
      if (document.querySelector('#app').dataset.screen !== 'play') return; // the grid is hidden on other screens
      const r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(v => Math.round(v * 10) / 10).join(','); };
      window.__sizes.add(`${r('#board')}|${r('.cell[data-index="0"]')}|${r('.cell[data-index="8"]')}|${r('#btn-position')}`);
    };
    const on = new Set();
    new MutationObserver((records) => {
      for (const el of new Set(records.map(m => m.target))) {
        const lit = el.classList.contains('lit');
        if (!lit) { on.delete(el); snap(); continue; }
        if (on.has(el)) continue;
        on.add(el);
        const idx = Number(el.dataset.index);
        seen.push(idx);
        snap();
        setTimeout(snap, 120);
        const i = seen.length - 1;
        if (i >= n && seen[i - n] === idx) {
          setTimeout(() => { document.querySelector('#btn-position').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0 })); setTimeout(snap, 60); }, 400);
        }
      }
    }).observe(document.querySelector('#board'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.waitForFunction(() => document.querySelector('#app').dataset.screen === 'results', null, { timeout: 45000 });
  const sizes = await page.evaluate(() => [...window.__sizes]);
  assert.equal(sizes.length, 1, `geometry is identical lit, unlit and pressed (saw: ${sizes.join('  ||  ')})`);
  assert.ok(sizes[0].startsWith(`${boardBefore}|${cellBefore}|`) && sizes[0].endsWith(`|${zoneBefore}`), `same geometry as before the first item (before ${boardBefore}|${cellBefore}|…|${zoneBefore}, during ${sizes[0]})`);
  const [entry] = await history(page);
  assert.equal(entry.errors, 0);
  assert.equal(entry.accuracy, 1);
  assert.deepEqual([entry.n, entry.nextN, entry.mode], [1, 2, 'position']);
  const s = await settings(page);
  assert.deepEqual(s.levels, { dual: 1, triple: 1, position: 2, sound: 1 }, 'only the mode that was played moves');
  assert.match(await page.textContent('.res-hero'), /You move up to 2-back/);
  assert.equal(await page.textContent('#btn-again'), 'Play again at 2-back');
  assert.equal(/points/i.test(await page.textContent('#stage')), false, 'the made-up points number is gone');
  // home shows the per-mode level
  await page.click('#btn-home');
  assert.equal(await page.textContent('#level-n'), '2');
  await page.click('#mode-chips [data-mode="dual"]');
  assert.equal(await page.textContent('#level-n'), '1');
  await page.context().close();
});

await check('missing every target at Position drops nothing below 1 and explains what is needed', async () => {
  const page = await open({ ...FAST, 'nback.settings.v1': { ...FAST['nback.settings.v1'], levels: { position: 2 } } });
  await page.click('#btn-start');
  await page.waitForFunction(() => document.querySelector('#app').dataset.screen === 'results', null, { timeout: 50000 });
  const [entry] = await history(page);
  assert.equal(entry.perStream.position.hits, 0);
  assert.ok(entry.perStream.position.misses >= 4);
  // 5 targets missed in a short block is over the "down" threshold (4 for 15 scorable items)
  assert.equal(entry.nextN, 1);
  assert.match(await page.textContent('.res-hero'), /Back to 1-back/);
  await page.context().close();
});

await check('the tutorial teaches 1-back then 2-back, and its unhinted practice is scored correctly', async () => {
  const page = await open({ 'nback.settings.v1': { tutorialVoice: false, sound: false, tones: false } });
  await page.waitForSelector('#dlg-welcome[open]', { timeout: 3000 });
  await page.click('#dlg-welcome button[value="tutorial"]');
  await page.waitForSelector('#coach:not([hidden])');
  assert.equal(await page.isVisible('#strip'), true);
  const board0 = await rect(page, '#board');
  const zone0 = await rect(page, '#btn-sound');
  const sizes = new Set();
  const titles = [];
  let guard = 0;
  let practiceSeen = false;
  while (guard++ < 400) {
    sizes.add(`${await rect(page, '#board')}|${await rect(page, '#btn-sound')}`);
    const title = await page.textContent('#coach-title');
    if (titles[titles.length - 1] !== title) titles.push(title);
    if (title === 'Practice done') break;
    if (title === 'Practice: 2-back') {
      practiceSeen = true;
      // no hints here: decide from the strip, exactly as a player would
      assert.equal(await page.$$eval('.action.cue', els => els.length), 0, 'practice has no button hints');
      const decision = await page.evaluate(() => {
        const read = (el) => el && { n: el.querySelector('.num').textContent, pos: [...el.querySelectorAll('.mini i')].findIndex(i => i.classList.contains('on')), letter: el.querySelector('.letter').textContent };
        const now = read(document.querySelector('.turn.now'));
        const back = read(document.querySelector('.turn.back'));
        if (!now || !back || window.__answered === now.n) return null;
        window.__answered = now.n;
        return { position: now.pos === back.pos, sound: now.letter === back.letter };
      });
      if (decision) {
        if (decision.position) await tap(page, '#btn-position');
        if (decision.sound) await tap(page, '#btn-sound');
      }
      await page.waitForTimeout(150);
      continue;
    }
    const hinted = await page.$$eval('.action.cue', els => els.map(e => e.dataset.stream));
    if (hinted.length) { await tap(page, `.action[data-stream="${hinted[0]}"]`); await page.waitForTimeout(200); continue; }
    if (await page.isVisible('#coach-next')) { await page.click('#coach-next'); await page.waitForTimeout(450); continue; }
    await page.waitForTimeout(200);
  }
  assert.ok(practiceSeen);
  assert.match(await page.textContent('#coach-text'), /You caught 8 of 8 matches with 0 mistakes/);
  for (const t of ['Welcome to N-back', 'Same square!', 'Same letter!', 'Both repeat', 'Nothing repeats', 'Now 2-back', 'Two to remember', 'Look two back', 'Skip the last one', 'Nothing matches', 'Practice: 2-back']) {
    assert.ok(titles.includes(t), `tutorial step "${t}" was shown`);
  }
  assert.deepEqual([...sizes], [`${board0}|${zone0}`], 'the grid and zones keep one size for the whole tutorial');
  await page.click('#coach-next');
  assert.equal(await screen(page), 'home');
  assert.equal(await page.evaluate(() => localStorage.getItem('nback.onboarded.v1')), 'true');
  assert.equal(await page.textContent('#level-n'), '1');
  await page.context().close();
});

await check('a wrong press in the tutorial is corrected, not accepted', async () => {
  const page = await open({ ...ONBOARDED, 'nback.settings.v1': { tutorialVoice: false, sound: false, tones: false } });
  await page.click('#nav-settings');
  await page.click('#btn-tutorial-settings');
  await page.waitForSelector('#coach:not([hidden])');
  await page.click('#coach-next');                  // welcome → watch
  await page.waitForTimeout(500);
  await page.click('#coach-next');                  // watch → position match
  await page.waitForFunction(() => document.querySelector('#coach-title').textContent === 'Same square!');
  await tap(page, '#btn-sound');
  await page.waitForFunction(() => document.querySelector('#coach-title').textContent === 'Not that one');
  await tap(page, '#btn-position');
  await page.waitForFunction(() => document.querySelector('#coach-title').textContent === 'Nice');
  // Skip leaves cleanly and Start works
  await page.click('#coach-skip');
  assert.equal(await screen(page), 'home');
  assert.equal(await page.isDisabled('#btn-start'), false);
  await page.context().close();
});

/* ---------- data ---------- */
function seedHistory() {
  const out = [];
  const day = 86400000;
  const now = Date.now();
  const per = a => ({ hits: Math.round(6 * a), misses: 6 - Math.round(6 * a), falseAlarms: 1, correctRejections: 13, targets: 6, accuracy: a, errors: 7 - Math.round(6 * a), meanRt: 600 });
  for (let d = 9; d >= 0; d--) {
    out.push({ ts: now - d * day - 3600000, n: 2, nextN: 2, mode: 'dual', length: 'standard', trials: 22, interval: 3000, durationMs: 66000, accuracy: 0.8, errors: 4, meanRt: 600, perStream: { position: per(0.85), sound: per(0.75) } });
    if (d % 3 === 0) out.push({ ts: now - d * day - 1800000, n: 3, nextN: 3, mode: 'position', length: 'standard', trials: 23, interval: 3000, durationMs: 69000, accuracy: 0.9, errors: 1, meanRt: 500, perStream: { position: per(0.9) } });
  }
  return out;
}

await check('Progress is filtered by mode and exports files', async () => {
  const page = await open({ ...ONBOARDED, 'nback.history.v1': seedHistory(), 'nback.settings.v1': { mode: 'dual', levels: { dual: 2, position: 3 } } });
  await page.click('#nav-stats');
  await page.waitForSelector('#stats-modes .chip');
  assert.deepEqual(await page.$$eval('#stats-modes .chip', els => els.map(e => e.textContent)), ['All', 'Dual', 'Position']);
  assert.equal(await page.getAttribute('#stats-modes .chip[data-filter="dual"]', 'aria-checked'), 'true', 'opens on the mode being played');
  assert.match(await page.textContent('#stats-tiles'), /10\s*sessions/);
  assert.match(await page.textContent('#stats-tiles'), /2-back\s*level now/);
  await page.click('#stats-modes .chip[data-filter="position"]');
  assert.match(await page.textContent('#stats-tiles'), /4\s*sessions/);
  assert.match(await page.textContent('#stats-tiles'), /3-back\s*level now/);
  await page.click('#stats-modes .chip[data-filter="all"]');
  assert.match(await page.textContent('#stats-tiles'), /14\s*sessions/);
  const [json] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
  assert.match(json.suggestedFilename(), /^nback-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
  assert.match(csv.suggestedFilename(), /\.csv$/);
  await page.context().close();
});

await check('a hostile or damaged backup file cannot inject markup or break settings', async () => {
  const page = await open({ ...ONBOARDED, 'nback.history.v1': seedHistory().slice(0, 2) });
  await page.click('#nav-stats');
  const evil = '<img src=x onerror="window.__pwned=1">';
  const good = seedHistory()[5];
  const backup = {
    app: 'nback',
    history: [{ ...good, ts: good.ts + 5 }, { ...good, ts: good.ts + 6, mode: evil }, { ts: evil, n: 2 }, null, { ...good, ts: good.ts + 7, n: 9999, extra: evil }],
    settings: { mode: evil, interval: -1, theme: evil, levels: { dual: 'x' }, reminders: { time: evil } },
    achievements: { [evil]: 1, first: 5 },
  };
  await page.setInputFiles('#file-import', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.waitForFunction(() => /Imported 2 new sessions/.test(document.querySelector('#toast').textContent));
  assert.match(await page.textContent('#toast'), /skipped 3 damaged/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.$$eval('#panel img[src="x"]', els => els.length), 0);
  const s = await settings(page);
  assert.deepEqual([s.mode, s.interval, s.theme, s.levels.dual, s.reminders.time], ['dual', 1500, 'auto', 1, '19:00']);
  // not JSON at all
  await page.setInputFiles('#file-import', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForFunction(() => /Import failed: not a valid backup file/.test(document.querySelector('#toast').textContent));
  await page.context().close();
});

await check('Settings: the level belongs to the current mode, sliders stay consistent, US spelling', async () => {
  const page = await open(ONBOARDED);
  await page.click('#nav-settings');
  await page.fill('[data-setting="level"]', '4');
  await page.dispatchEvent('[data-setting="level"]', 'change');
  await page.selectOption('[data-setting="mode"]', 'triple');
  assert.equal(await page.inputValue('[data-setting="level"]'), '1');
  let s = await settings(page);
  assert.deepEqual([s.levels.dual, s.levels.triple], [4, 1]);
  // pace at its fastest forces the lit time to stay shorter than an item
  await page.$eval('[data-setting="stimulusMs"]', (el) => { el.value = 1500; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('[data-setting="interval"]', (el) => { el.value = 1500; el.dispatchEvent(new Event('input', { bubbles: true })); });
  s = await settings(page);
  assert.deepEqual([s.interval, s.stimulusMs], [1500, 1200]);
  assert.equal(/colour/i.test(await page.textContent('#view-settings')), false);
  assert.equal(await page.isVisible('#btn-reminder-ics'), true, 'calendar fallback is offered in a browser');
  await page.context().close();
});

await check('the explainer video opens from home and hands off to the tutorial', async () => {
  const page = await open(ONBOARDED);
  await page.click('#btn-video-home');
  await page.waitForSelector('#dlg-video[open]');
  assert.equal(await page.$eval('#video-2back', v => v.readyState >= 1 || v.networkState === 2), true, 'video source loads');
  await page.click('#dlg-video button[value="tutorial"]');
  await page.waitForSelector('#coach:not([hidden])');
  assert.equal(await page.getAttribute('#app', 'data-tutorial'), 'on');
  await page.click('#coach-skip');
  assert.equal(await page.isVisible('#btn-video-home'), false, 'the card goes away once watched');
  await page.context().close();
});

await check('fold postures put the grid and the controls on opposite sides of the hinge', async () => {
  const box = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
  // tabletop: 840x757 with a 28px horizontal hinge → upper screen ends at 364.5, lower starts at 392.5
  let page = await open(FAST, { width: 840, height: 757 }, '?posture=tabletop&hinge=28');
  await page.click('#btn-start');
  await waitForItem(page);
  let board = await box(page, '#board');
  let zone = await box(page, '#btn-position');
  assert.ok(board.bottom <= 364.5 + 0.5, `grid stays on the upper screen (bottom ${board.bottom})`);
  assert.ok(zone.top >= 392.5 - 0.5, `zones stay on the lower screen (top ${zone.top})`);
  await page.context().close();
  // book: vertical hinge → left screen ends at 406, right starts at 434
  page = await open(FAST, { width: 840, height: 757 }, '?posture=book&hinge=28');
  await page.click('#btn-start');
  await waitForItem(page);
  board = await box(page, '#board');
  zone = await box(page, '#btn-position');
  assert.ok(board.right <= 406 + 0.5, `grid stays on the left screen (right ${board.right})`);
  assert.ok(zone.left >= 434 - 0.5, `zones stay on the right screen (left ${zone.left})`);
  await page.context().close();
});

await browser.close();
console.log(`\n${passed} end-to-end checks passed, no console errors`);
