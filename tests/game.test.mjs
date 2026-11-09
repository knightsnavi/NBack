import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTERS, POSITIONS, COLORS, generateSequence, scoreBlock, nextN, trialsForN, seededRandom, targetPlan, levelUpGap,
} from '../www/js/game.js';

test('block length is base + n', () => {
  assert.equal(trialsForN(1), 21);
  assert.equal(trialsForN(3), 23);
  assert.equal(trialsForN(2, 'short'), 17);
  assert.equal(trialsForN(2, 'long'), 32);
  assert.equal(generateSequence(2, { rng: seededRandom(1) }).trials.length, 22);
});

test('standard plan is 6 targets per stream with 2 shared', () => {
  assert.deepEqual(targetPlan(20, 2), { perStream: 6, shared: 2 });
  assert.deepEqual(targetPlan(20, 1), { perStream: 6, shared: 0 });
  assert.deepEqual(targetPlan(20, 3), { perStream: 6, shared: 2 });
});

function checkSequence(seq, n) {
  const counts = Object.fromEntries(seq.streams.map(s => [s, 0]));
  let allShared = 0;
  for (let i = 0; i < seq.trials.length; i++) {
    const t = seq.trials[i];
    assert.ok(POSITIONS.includes(t.values.position));
    assert.ok(LETTERS.includes(t.values.sound));
    assert.ok(t.values.color >= 0 && t.values.color < COLORS.length);
    if (i < n) {
      for (const s of ['position', 'sound', 'color']) assert.equal(t.match[s], false);
      continue;
    }
    const back = seq.trials[i - n];
    for (const s of ['position', 'sound', 'color']) {
      if (seq.streams.includes(s)) {
        assert.equal(t.match[s], back.values[s] === t.values[s], `${s} flag mismatch at ${i}`);
        if (t.match[s]) counts[s]++;
      } else {
        assert.equal(t.match[s], false, `inactive stream ${s} flagged at ${i}`);
      }
    }
    if (seq.streams.every(s => t.match[s])) allShared++;
  }
  return { counts, allShared };
}

test('dual sequences have exact target counts and no accidental matches', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const n of [1, 2, 3, 5]) {
      const seq = generateSequence(n, { rng: seededRandom(seed) });
      const { counts, allShared } = checkSequence(seq, n);
      assert.equal(counts.position, 6);
      assert.equal(counts.sound, 6);
      assert.equal(allShared, 2);
    }
  }
});

test('triple sequences target all three streams', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const seq = generateSequence(2, { rng: seededRandom(seed), mode: 'triple' });
    const { counts, allShared } = checkSequence(seq, 2);
    assert.deepEqual(seq.streams, ['position', 'sound', 'color']);
    assert.equal(counts.position, 6);
    assert.equal(counts.sound, 6);
    assert.equal(counts.color, 6);
    assert.equal(allShared, 2);
  }
});

test('single-stream modes have no targets in the other streams', () => {
  const p = generateSequence(2, { rng: seededRandom(3), mode: 'position' });
  const pc = checkSequence(p, 2).counts;
  assert.deepEqual(p.streams, ['position']);
  assert.equal(pc.position, 6);
  const s = generateSequence(2, { rng: seededRandom(3), mode: 'sound' });
  assert.equal(checkSequence(s, 2).counts.sound, 6);
});

test('short and long blocks scale their targets', () => {
  const short = generateSequence(2, { rng: seededRandom(5), length: 'short' });
  assert.equal(short.trials.length, 17);
  assert.equal(checkSequence(short, 2).counts.position, 5);
  const long = generateSequence(2, { rng: seededRandom(5), length: 'long' });
  assert.equal(long.trials.length, 32);
  assert.equal(checkSequence(long, 2).counts.sound, 9);
});

test('perfect play scores 100% with zero errors and records reaction time', () => {
  const seq = generateSequence(2, { rng: seededRandom(7) });
  const responses = seq.trials.map(t => {
    const r = {};
    if (t.match.position) r.position = 400;
    if (t.match.sound) r.sound = 600;
    return r;
  });
  const score = scoreBlock(seq, responses);
  assert.equal(score.errors, 0);
  assert.equal(score.perStream.position.hits, 6);
  assert.equal(score.perStream.sound.hits, 6);
  assert.equal(score.accuracy, 1);
  assert.equal(score.perStream.position.meanRt, 400);
  assert.equal(score.meanRt, 500);
});

test('no responses counts every target as a miss', () => {
  const seq = generateSequence(2, { rng: seededRandom(9) });
  const score = scoreBlock(seq, []);
  assert.equal(score.perStream.position.misses, 6);
  assert.equal(score.perStream.sound.misses, 6);
  assert.equal(score.errors, 12);
  assert.equal(score.perStream.position.accuracy, 0);
  assert.equal(score.meanRt, null);
});

test('false alarms count as errors and lower accuracy', () => {
  const seq = generateSequence(2, { rng: seededRandom(11) });
  const responses = seq.trials.map(t => ({ position: 300, ...(t.match.sound ? { sound: 300 } : {}) }));
  const score = scoreBlock(seq, responses);
  assert.equal(score.perStream.position.hits, 6);
  assert.equal(score.perStream.position.falseAlarms, seq.trials.length - 2 - 6);
  assert.equal(score.perStream.sound.errors, 0);
  assert.ok(score.perStream.position.accuracy < 0.5);
});

test('responses during the first n trials are ignored', () => {
  const seq = generateSequence(3, { rng: seededRandom(13) });
  const responses = [{ position: 1, sound: 1 }, { position: 1, sound: 1 }, { position: 1, sound: 1 }];
  const score = scoreBlock(seq, responses);
  assert.equal(score.perStream.position.falseAlarms, 0);
  assert.equal(score.perStream.sound.falseAlarms, 0);
});

test('adaptive rule follows Jaeggi thresholds and scales with block length', () => {
  assert.equal(nextN(2, 0), 3);
  assert.equal(nextN(2, 2), 3);
  assert.equal(nextN(2, 3), 2);
  assert.equal(nextN(2, 5), 2);
  assert.equal(nextN(2, 6), 1);
  assert.equal(nextN(1, 10), 1);
  assert.equal(nextN(9, 0), 9);
  // long block (30 scorable): thresholds become 5 and 8
  assert.equal(nextN(2, 4, { scorable: 30 }), 3);
  assert.equal(nextN(2, 8, { scorable: 30 }), 2);
  assert.equal(nextN(2, 9, { scorable: 30 }), 1);
});

test('relaxed rule uses accuracy thresholds', () => {
  assert.equal(nextN(2, 6, { rule: 'relaxed', accuracy: 0.8 }), 3);
  assert.equal(nextN(2, 1, { rule: 'relaxed', accuracy: 0.79 }), 2);
  assert.equal(nextN(2, 9, { rule: 'relaxed', accuracy: 0.49 }), 1);
  assert.equal(nextN(1, 9, { rule: 'relaxed', accuracy: 0.1 }), 1);
  assert.equal(nextN(9, 0, { rule: 'relaxed', accuracy: 1 }), 9);
});

test('level-up gap reports how close a block was', () => {
  assert.deepEqual(levelUpGap(4, 0.7), { kind: 'errors', target: 3, gap: 2 });
  assert.deepEqual(levelUpGap(2, 0.9), { kind: 'errors', target: 3, gap: 0 });
  assert.deepEqual(levelUpGap(6, 0.75, { scorable: 30 }), { kind: 'errors', target: 5, gap: 2 });
  const r = levelUpGap(5, 0.7, { rule: 'relaxed' });
  assert.equal(r.kind, 'accuracy');
  assert.ok(Math.abs(r.gap - 0.1) < 1e-9);
});
