import test from 'node:test';
import assert from 'node:assert/strict';

// minimal localStorage for Node
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};

const S = await import('../www/js/storage.js');

const goodEntry = (over = {}) => ({
  ts: new Date(2026, 5, 10, 9).getTime(), n: 2, nextN: 3, mode: 'dual', length: 'standard', trials: 22, interval: 3000,
  durationMs: 66000, accuracy: 0.9, errors: 2, meanRt: 640,
  perStream: {
    position: { hits: 5, misses: 1, falseAlarms: 0, correctRejections: 14, targets: 6, accuracy: 5 / 6, errors: 1, meanRt: 600 },
    sound: { hits: 5, misses: 0, falseAlarms: 1, correctRejections: 13, targets: 6, accuracy: 5 / 6, errors: 1, meanRt: 680 },
  },
  ...over,
});

test('defaults: every mode starts at 1-back', () => {
  store.clear();
  const s = S.loadSettings();
  assert.deepEqual(s.levels, { dual: 1, triple: 1, position: 1, sound: 1 });
  assert.equal(S.levelFor(s), 1);
});

test('a shared level from an older version carries into every mode', () => {
  const s = S.sanitizeSettings({ n: 4, mode: 'triple' });
  assert.deepEqual(s.levels, { dual: 4, triple: 4, position: 4, sound: 4 });
  assert.equal(S.levelFor(s), 4);
  assert.equal('n' in s, false);
});

test('levels are independent per mode', () => {
  const s = S.sanitizeSettings({});
  S.setLevel(s, 5, 'position');
  assert.equal(S.levelFor(s, 'position'), 5);
  assert.equal(S.levelFor(s, 'dual'), 1);
  assert.equal(S.setLevel(s, 99, 'dual'), 9);
  assert.equal(S.setLevel(s, -3, 'dual'), 1);
});

test('garbage settings are replaced by safe values', () => {
  const s = S.sanitizeSettings({
    interval: 0, stimulusMs: 99999, volume: 'loud', mode: '<img src=x onerror=alert(1)>', theme: 7,
    dailyGoal: -4, reminders: { enabled: 'yes', time: '25:99' }, levels: { dual: 'x', triple: 40 }, adaptive: 'no',
  });
  assert.equal(s.interval, 1500);
  assert.equal(s.stimulusMs, 1200, 'stimulus is kept shorter than the interval');
  assert.equal(s.volume, 0.9);
  assert.equal(s.mode, 'dual');
  assert.equal(s.theme, 'auto');
  assert.equal(s.dailyGoal, 0);
  assert.deepEqual(s.reminders, { enabled: false, time: '19:00' });
  assert.deepEqual(s.levels, { dual: 1, triple: 9, position: 1, sound: 1 });
  assert.equal(s.adaptive, true);
  assert.deepEqual(S.sanitizeSettings(null), S.sanitizeSettings({}));
});

test('session records are validated', () => {
  assert.ok(S.sanitizeEntry(goodEntry()));
  assert.equal(S.sanitizeEntry(null), null);
  assert.equal(S.sanitizeEntry(goodEntry({ ts: 'yesterday' })), null);
  assert.equal(S.sanitizeEntry(goodEntry({ mode: '<script>' })), null);
  assert.equal(S.sanitizeEntry(goodEntry({ perStream: {} })), null);
  const fixed = S.sanitizeEntry(goodEntry({ n: 42, accuracy: 7, nextN: 'up', meanRt: 'fast', extra: '<b>x</b>' }));
  assert.equal(fixed.n, 9);
  assert.equal(fixed.accuracy, 1);
  assert.equal(fixed.nextN, 9);
  assert.equal(fixed.meanRt, null);
  assert.equal('extra' in fixed, false);
  assert.equal(fixed.errors, 2, 'errors are recomputed from the streams');
});

test('import merges valid sessions, drops bad ones, and sanitizes settings', () => {
  store.clear();
  S.appendHistory(goodEntry());
  const res = S.importData({
    app: 'nback',
    history: [goodEntry(), goodEntry({ ts: goodEntry().ts + 1000 }), { ts: 5, junk: true }, 'nope'],
    settings: { mode: 'triple', interval: -5, levels: { triple: 3 } },
    achievements: { first: 123, '<x>': 5, n3: 'soon' },
  });
  assert.deepEqual({ added: res.added, skipped: res.skipped }, { added: 1, skipped: 2 });
  assert.equal(S.loadHistory().length, 2);
  const s = S.loadSettings();
  assert.equal(s.mode, 'triple');
  assert.equal(s.interval, 1500);
  assert.equal(s.levels.triple, 3);
  assert.deepEqual(S.loadAchievements(), { first: 123 });
  assert.throws(() => S.importData({ app: 'other', history: [] }), /Not an NBack backup/);
  assert.throws(() => S.importData('text'), /Not an NBack backup/);
});

test('a failed save is reported once', () => {
  let calls = 0;
  S.onStorageError(() => { calls++; });
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(S.saveSettings(S.loadSettings()), false);
  S.saveMeta({});
  localStorage.setItem = original;
  assert.equal(calls, 1);
});

test('streaks count calendar days, including across a daylight-saving change', () => {
  const at = (y, m, d, h = 9) => new Date(y, m - 1, d, h).getTime();
  const sessions = days => days.map(([y, m, d, h]) => ({ ts: at(y, m, d, h) }));
  // US clocks go back on 2026-11-01 (a 25-hour day) and forward on 2026-03-08 (23 hours)
  const fall = sessions([[2026, 10, 30], [2026, 10, 31], [2026, 11, 1], [2026, 11, 2], [2026, 11, 3]]);
  assert.equal(S.computeStreak(fall, at(2026, 11, 3, 23)), 5);
  assert.equal(S.longestStreak(fall), 5);
  const spring = sessions([[2026, 3, 6], [2026, 3, 7], [2026, 3, 8, 23], [2026, 3, 9, 0]]);
  assert.equal(S.computeStreak(spring, at(2026, 3, 9, 1)), 4);
  assert.equal(S.longestStreak(spring), 4);
  // a gap breaks it; yesterday still counts as a live streak
  const gap = sessions([[2026, 6, 1], [2026, 6, 2], [2026, 6, 4]]);
  assert.equal(S.computeStreak(gap, at(2026, 6, 5)), 1);
  assert.equal(S.computeStreak(gap, at(2026, 6, 6)), 0);
  assert.equal(S.longestStreak(gap), 2);
  assert.equal(S.dayKey(S.addDays(at(2026, 11, 1, 0), 1)), '2026-11-02');
  assert.equal(S.dayKey(S.addDays(at(2026, 3, 8, 23), -1)), '2026-03-07');
});
