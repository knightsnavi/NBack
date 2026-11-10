import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};

const ST = await import('../www/js/stats.js');
const { ACHIEVEMENTS } = await import('../www/js/achievements.js');

const NOW = new Date(2026, 5, 10, 18).getTime();
const stream = (accuracy, errors) => ({ hits: 6 - errors, misses: errors, falseAlarms: 0, correctRejections: 14, targets: 6, accuracy, errors, meanRt: 500 });
const session = (hoursAgo, over = {}) => ({
  ts: NOW - hoursAgo * 3600000, n: 2, nextN: 2, mode: 'dual', length: 'standard', trials: 22, interval: 3000, durationMs: 66000,
  accuracy: 0.5, errors: 6, meanRt: 700, perStream: { position: stream(0.5, 3), sound: stream(0.5, 3) }, ...over,
});
const perfectAssisted = hoursAgo => session(hoursAgo, { assisted: true, n: 3, nextN: 3, accuracy: 1, errors: 0, meanRt: 300, perStream: { position: stream(1, 0), sound: stream(1, 0) } });

test('assisted rounds count as training but not as performance', () => {
  const history = [session(30), session(5), perfectAssisted(4), perfectAssisted(3)];
  const sum = ST.summarize(history, NOW);
  // training volume: everything counts
  assert.equal(sum.sessions, 4);
  assert.equal(sum.todayCount, 3);
  assert.equal(sum.streak, 2);
  assert.equal(sum.assistedSessions, 2);
  assert.equal(sum.totalMs, 4 * 66000);
  // performance: only the two unassisted rounds
  assert.equal(sum.bestN, 2);
  assert.equal(sum.bestFullN, 2);
  assert.equal(sum.bestAccuracy, 0.5);
  assert.equal(sum.perfectSessions, 0);
  assert.equal(sum.fastestRt, 700);
  assert.equal(sum.streamAcc.position, 0.5);
  assert.equal(ST.nTrend(history).length, 2);
  assert.equal(ST.accuracyTrend(history).count, 2);
});

test('assisted rounds cannot unlock skill achievements', () => {
  const history = [perfectAssisted(2)];
  const context = { summary: ST.summarize(history, NOW), lastSession: history[0], settings: { dailyGoal: 5 }, history };
  const unlocked = ACHIEVEMENTS.filter(a => a.check(context)).map(a => a.id);
  assert.deepEqual(unlocked, ['first'], 'only "first session" is earned; not Flawless, Three deep or Quick draw');
});
