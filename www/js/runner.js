// Timing for one block of trials. No DOM and no globals: the clock and timers
// are injected, so the whole thing is unit-testable with a fake clock.
//
// Lifecycle:  idle → running ⇄ paused → ending → finished
//
// Hooks (all optional):
//   onTrialStart(index, trial, { replay })   stimulus goes on (replay = after a pause)
//   onStimulusEnd(index)                     stimulus goes off
//   onTrialSettled(index, missedStreams)     final verdict for a trial, after the grace window
//   onFinish(responses)                      block complete
//
// A press counts for the item on screen. One exception, the grace window: a press
// that lands within `graceMs` of a new item is credited to the PREVIOUS item when
// that item had a target in the same stream that was not answered yet. Misses are
// therefore only reported once the grace window has closed.

export const GRACE_MS = 300;

const realEnv = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
};

export class Runner {
  constructor(sequence, { interval, stimulusMs, graceMs = GRACE_MS }, hooks = {}, env = realEnv) {
    this.seq = sequence;
    this.interval = interval;
    this.stimulusMs = Math.max(100, Math.min(stimulusMs, interval - 200));
    this.graceMs = Math.min(graceMs, Math.max(0, interval - 100));
    this.hooks = hooks;
    this.env = env;
    this.state = 'idle';
    this.index = -1;
    this.responses = [];
    this.timers = new Map();
    this.onsetAt = 0;        // when the current trial (or the ending window) began
    this.plannedOnset = 0;   // drift-free schedule: trial i starts at plannedOnset
    this.pendingSettle = null; // index of the trial still inside its grace window
    this.pendingOnsetAt = 0;
    this.stimulusOn = false;
  }

  get paused() { return this.state === 'paused'; }
  get finished() { return this.state === 'finished'; }
  get active() { return this.state === 'running' || this.state === 'ending'; }

  /* ---------- timers ---------- */
  setTimer(name, ms, fn) {
    this.clearTimer(name);
    this.timers.set(name, this.env.setTimeout(() => { this.timers.delete(name); fn(); }, Math.max(0, ms)));
  }
  clearTimer(name) {
    if (this.timers.has(name)) { this.env.clearTimeout(this.timers.get(name)); this.timers.delete(name); }
  }
  clearTimers() {
    for (const id of this.timers.values()) this.env.clearTimeout(id);
    this.timers.clear();
  }

  /* ---------- flow ---------- */
  start() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.plannedOnset = this.env.now();
    this.beginTrial(0, false);
  }

  beginTrial(index, replay) {
    const now = this.env.now();
    this.index = index;
    if (!replay) this.responses[index] = {};
    this.onsetAt = now;
    this.stimulusOn = true;
    if (this.hooks.onTrialStart) this.hooks.onTrialStart(index, this.seq.trials[index], { replay });
    this.setTimer('stimulus', this.stimulusMs, () => this.endStimulus());
    this.setTimer('trial', this.plannedOnset + this.interval - now, () => this.endTrial());
    if (this.pendingSettle != null) this.setTimer('settle', this.graceMs, () => this.settle());
  }

  endStimulus() {
    if (!this.stimulusOn) return;
    this.stimulusOn = false;
    this.clearTimer('stimulus');
    if (this.hooks.onStimulusEnd) this.hooks.onStimulusEnd(this.index);
  }

  endTrial() {
    this.endStimulus();
    this.settle(); // only relevant if the grace window is as long as a trial
    this.pendingSettle = this.index;
    this.pendingOnsetAt = this.onsetAt;
    if (this.index + 1 < this.seq.trials.length) {
      this.plannedOnset += this.interval;
      this.beginTrial(this.index + 1, false);
    } else {
      // Last trial: keep the grace window open, then finish.
      this.state = 'ending';
      this.onsetAt = this.env.now();
      this.setTimer('settle', this.graceMs, () => { this.settle(); this.finish(); });
    }
  }

  /** Close the grace window for the previous trial and report what was missed. */
  settle() {
    const i = this.pendingSettle;
    if (i == null) return;
    this.pendingSettle = null;
    this.clearTimer('settle');
    const trial = this.seq.trials[i];
    const r = this.responses[i] || {};
    const missed = i >= this.seq.n ? this.seq.streams.filter(s => trial.match[s] && r[s] == null) : [];
    if (this.hooks.onTrialSettled) this.hooks.onTrialSettled(i, missed);
  }

  finish() {
    this.clearTimers();
    this.state = 'finished';
    if (this.hooks.onFinish) this.hooks.onFinish(this.responses);
  }

  /* ---------- input ---------- */
  respond(stream) {
    if (!this.active || !this.seq.streams.includes(stream)) return { ignored: true };
    const now = this.env.now();
    const sinceOnset = now - this.onsetAt;

    // Late reaction to the previous item.
    const p = this.pendingSettle;
    if (p != null && p >= this.seq.n && sinceOnset < this.graceMs) {
      const prev = this.responses[p];
      if (prev[stream] == null && this.seq.trials[p].match[stream]) {
        prev[stream] = Math.round(now - this.pendingOnsetAt);
        return { correct: true, rt: prev[stream], late: true, index: p };
      }
    }
    if (this.state === 'ending') return { ignored: true };
    if (this.index < this.seq.n) return { tooEarly: true };
    const r = this.responses[this.index];
    if (r[stream] != null) return { duplicate: true };
    r[stream] = Math.round(sinceOnset);
    return { correct: Boolean(this.seq.trials[this.index].match[stream]), rt: r[stream], index: this.index };
  }

  /* ---------- pause / resume / stop ---------- */
  /** Returns true when the block is now paused. The closing grace window cannot be paused. */
  pause() {
    if (this.state !== 'running') return false;
    this.settle();
    this.clearTimers();
    this.stimulusOn = false;
    this.state = 'paused';
    return true;
  }

  /** Replays the current item in full (square and letter) and gives it a whole interval. */
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.plannedOnset = this.env.now();
    this.beginTrial(this.index, true);
  }

  stop() {
    this.clearTimers();
    this.state = 'finished';
  }
}
