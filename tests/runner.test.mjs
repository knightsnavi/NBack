import test from 'node:test';
import assert from 'node:assert/strict';
import { Runner, GRACE_MS } from '../www/js/runner.js';
import { generateSequence, scoreBlock, seededRandom } from '../www/js/game.js';

/** Deterministic clock: timers fire in time order as the clock advances. */
class FakeClock {
  constructor() { this.t = 0; this.next = 1; this.timers = new Map(); }
  now = () => this.t;
  setTimeout = (fn, ms) => { const id = this.next++; this.timers.set(id, { at: this.t + Math.max(0, ms), fn, id }); return id; };
  clearTimeout = (id) => { this.timers.delete(id); };
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let due = null;
      for (const tm of this.timers.values()) if (tm.at <= end && (!due || tm.at < due.at || (tm.at === due.at && tm.id < due.id))) due = tm;
      if (!due) break;
      this.timers.delete(due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

const INTERVAL = 3000;
const STIM = 500;

function setup(n = 2, seed = 5, opts = {}) {
  const clock = new FakeClock();
  const seq = generateSequence(n, { rng: seededRandom(seed), ...opts });
  const log = { starts: [], stimEnds: [], settled: [], finished: null };
  const runner = new Runner(seq, { interval: INTERVAL, stimulusMs: STIM }, {
    onTrialStart: (i, trial, info) => log.starts.push({ i, at: clock.t, replay: info.replay }),
    onStimulusEnd: i => log.stimEnds.push({ i, at: clock.t }),
    onTrialSettled: (i, missed) => log.settled.push({ i, missed, at: clock.t }),
    onFinish: responses => { log.finished = { at: clock.t, responses }; },
  }, clock);
  return { clock, seq, runner, log };
}

const firstTarget = (seq, stream, from = seq.n) => seq.trials.findIndex((t, i) => i >= from && t.match[stream]);
const firstNonTarget = (seq, stream, from = seq.n) => seq.trials.findIndex((t, i) => i >= from && !t.match[stream]);

test('trials start exactly one interval apart and the block finishes after the last grace window', () => {
  const { clock, seq, runner, log } = setup();
  runner.start();
  clock.advance(seq.trials.length * INTERVAL + GRACE_MS + 1);
  assert.equal(log.starts.length, seq.trials.length);
  log.starts.forEach((s, k) => assert.equal(s.at, k * INTERVAL));
  log.stimEnds.forEach((s, k) => assert.equal(s.at, k * INTERVAL + STIM));
  assert.equal(log.finished.at, seq.trials.length * INTERVAL + GRACE_MS);
  assert.equal(runner.finished, true);
  assert.equal(log.settled.length, seq.trials.length);
});

test('a hit is recorded with its reaction time', () => {
  const { clock, seq, runner } = setup();
  const i = firstTarget(seq, 'position');
  runner.start();
  clock.advance(i * INTERVAL + 640);
  assert.deepEqual(runner.respond('position'), { correct: true, rt: 640, index: i });
  assert.equal(runner.responses[i].position, 640);
});

test('a press with no match is a false tap; a second press in the same trial is ignored', () => {
  const { clock, seq, runner } = setup();
  // pick a non-target whose previous trial is also a non-target, so the grace rule is not in play
  let i = seq.n + 1;
  while (seq.trials[i].match.sound || seq.trials[i - 1].match.sound) i++;
  runner.start();
  clock.advance(i * INTERVAL + 100);
  assert.equal(runner.respond('sound').correct, false);
  assert.deepEqual(runner.respond('sound'), { duplicate: true });
});

test('presses during the memorize phase are flagged as too early and not scored', () => {
  const { clock, seq, runner } = setup(3);
  runner.start();
  clock.advance(INTERVAL + 200);
  assert.deepEqual(runner.respond('position'), { tooEarly: true });
  clock.advance(seq.trials.length * INTERVAL);
  assert.equal(scoreBlock(seq, runner.responses).perStream.position.falseAlarms, 0);
});

test('streams that are not part of the mode are ignored', () => {
  const { clock, runner } = setup(2, 5, { mode: 'position' });
  runner.start();
  clock.advance(2 * INTERVAL + 100);
  assert.deepEqual(runner.respond('sound'), { ignored: true });
});

test('a miss is reported only after the grace window closes', () => {
  const { clock, seq, runner, log } = setup();
  const i = firstTarget(seq, 'sound');
  runner.start();
  clock.advance((i + 1) * INTERVAL + GRACE_MS - 1);
  assert.equal(log.settled.find(s => s.i === i), undefined, 'not settled inside the grace window');
  clock.advance(1);
  const settled = log.settled.find(s => s.i === i);
  assert.ok(settled.missed.includes('sound'));
});

test('a late press inside the grace window rescues the previous target and no miss is reported', () => {
  const { clock, seq, runner, log } = setup();
  const i = firstTarget(seq, 'position');
  runner.start();
  clock.advance((i + 1) * INTERVAL + 120);
  const res = runner.respond('position');
  assert.equal(res.late, true);
  assert.equal(res.correct, true);
  assert.equal(res.index, i);
  assert.equal(res.rt, INTERVAL + 120);
  clock.advance(GRACE_MS);
  assert.deepEqual(log.settled.find(s => s.i === i).missed.filter(s => s === 'position'), []);
  assert.equal(runner.responses[i + 1].position, undefined, 'the next trial is untouched');
});

test('a press after the grace window is scored on the current trial', () => {
  const { clock, seq, runner } = setup();
  const i = firstTarget(seq, 'position');
  runner.start();
  clock.advance((i + 1) * INTERVAL + GRACE_MS + 50);
  const res = runner.respond('position');
  assert.equal(res.late, undefined);
  assert.equal(res.index, i + 1);
  assert.equal(res.correct, seq.trials[i + 1].match.position);
});

test('the grace window does not swallow a press when the previous item had no open target', () => {
  const { clock, seq, runner } = setup();
  const i = firstNonTarget(seq, 'sound');
  runner.start();
  clock.advance((i + 1) * INTERVAL + 100);
  const res = runner.respond('sound');
  assert.equal(res.late, undefined);
  assert.equal(res.index, i + 1);
});

test('a late press on the very last trial still counts', () => {
  const clock = new FakeClock();
  const seq = generateSequence(1, { rng: seededRandom(2), trials: 4 });
  seq.trials[3].match.position = true; // force a target on the final trial
  seq.trials[3].values.position = seq.trials[2].values.position;
  let finished = null;
  const runner = new Runner(seq, { interval: INTERVAL, stimulusMs: STIM }, { onFinish: r => { finished = r; } }, clock);
  runner.start();
  clock.advance(4 * INTERVAL + 100);
  assert.equal(runner.state, 'ending');
  assert.equal(runner.respond('position').late, true);
  assert.deepEqual(runner.respond('position'), { ignored: true }, 'nothing else is accepted while ending');
  clock.advance(GRACE_MS);
  assert.ok(finished);
  assert.equal(scoreBlock(seq, finished).perStream.position.misses, seq.trials.slice(1, 3).filter(t => t.match.position).length);
});

test('pause freezes the block; resume replays the current item with a full interval and keeps answers', () => {
  const { clock, seq, runner, log } = setup();
  const i = firstTarget(seq, 'position');
  runner.start();
  clock.advance(i * INTERVAL + 700);
  runner.respond('position');
  assert.equal(runner.pause(), true);
  const startsBefore = log.starts.length;
  clock.advance(60000);
  assert.equal(log.starts.length, startsBefore, 'nothing happens while paused');
  runner.resume();
  const replay = log.starts[log.starts.length - 1];
  assert.deepEqual({ i: replay.i, replay: replay.replay }, { i, replay: true });
  assert.equal(runner.responses[i].position, 700, 'the earlier answer survives');
  assert.deepEqual(runner.respond('position'), { duplicate: true });
  clock.advance(INTERVAL);
  assert.equal(log.starts[log.starts.length - 1].i, i + 1, 'the next item follows a full interval later');
  clock.advance(seq.trials.length * INTERVAL);
  assert.equal(log.starts.filter(s => !s.replay).length, seq.trials.length, 'every trial is presented exactly once');
});

test('pausing settles the previous item first, so nothing is left hanging', () => {
  const { clock, seq, runner, log } = setup();
  const i = firstTarget(seq, 'sound');
  runner.start();
  clock.advance((i + 1) * INTERVAL + 50);
  runner.pause();
  assert.ok(log.settled.find(s => s.i === i).missed.includes('sound'));
  runner.resume();
  assert.equal(runner.respond('sound').late, undefined, 'no grace credit after a pause');
});

test('stop silences the runner', () => {
  const { clock, runner, log } = setup();
  runner.start();
  clock.advance(INTERVAL + 10);
  runner.stop();
  const count = log.starts.length;
  clock.advance(100000);
  assert.equal(log.starts.length, count);
  assert.equal(log.finished, null);
  assert.deepEqual(runner.respond('position'), { ignored: true });
});

test('start is idempotent: a second call does not create a second timeline', () => {
  const { clock, runner, log } = setup();
  runner.start();
  runner.start();
  clock.advance(2 * INTERVAL + 1);
  assert.deepEqual(log.starts.map(s => s.i), [0, 1, 2]);
});

test('a perfect player driven through the runner scores zero errors', () => {
  const { clock, seq, runner, log } = setup(2, 21);
  runner.start();
  for (let i = 0; i < seq.trials.length; i++) {
    clock.advance(400);
    for (const s of seq.streams) if (seq.trials[i].match[s]) runner.respond(s);
    clock.advance(INTERVAL - 400);
  }
  clock.advance(GRACE_MS);
  const score = scoreBlock(seq, log.finished.responses);
  assert.equal(score.errors, 0);
  assert.equal(score.accuracy, 1);
  assert.ok(log.settled.every(s => s.missed.length === 0));
});

test('the stimulus is never longer than the trial', () => {
  const clock = new FakeClock();
  const seq = generateSequence(1, { rng: seededRandom(1), trials: 3 });
  const ends = [];
  const runner = new Runner(seq, { interval: 1500, stimulusMs: 5000 }, { onStimulusEnd: i => ends.push({ i, at: clock.t }) }, clock);
  runner.start();
  clock.advance(1500);
  assert.deepEqual(ends[0], { i: 0, at: 1300 });
});
