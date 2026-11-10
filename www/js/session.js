// One training session, as an explicit state machine:
//
//   idle → starting → countdown → running ⇄ paused → (resuming → running) → idle
//
// Every transition goes through this module, so a second tap on Start, a back
// gesture during the countdown, or the app going to the background can never
// leave two sessions running or a countdown that cannot be cancelled.
import { $, toast, confirmDialog, reduceMotion, sleep } from './dom.js';
import { state, audio, saveSettings } from './state.js';
import { show } from './nav.js';
import { Runner } from './runner.js';
import * as G from './game.js';
import * as S from './storage.js';
import * as ST from './stats.js';
import { evaluate } from './achievements.js';
import { clearCells, lightCell, speakLetter, setBadge, setZones, flash, pulsePress, buzz, sfx } from './board.js';
import { armReminders } from './effects.js';
import * as N from './native.js';

let phase = 'idle';
let token = 0;          // bumped to cancel whatever async step is in flight
let runner = null;
let sequence = null;
let sessionStart = 0;
let pausedMs = 0;
let pauseStartedAt = 0;
let finishedHandler = null;

export const sessionPhase = () => phase;
export const sessionActive = () => phase !== 'idle';

/** fn(entry, score) is called when a session completes and has been saved. */
export function onSessionFinished(fn) {
  finishedHandler = fn;
}

function setPhase(next) {
  phase = next;
  N.keepAwake(next !== 'idle' || state.tutorialActive);
  const start = $('#btn-start');
  if (start) start.disabled = next !== 'idle';
}

/* ---------- small UI pieces ---------- */
function renderProgress(index) {
  const total = sequence ? sequence.trials.length : 1;
  $('#progress-fill').style.width = `${Math.max(0, Math.min(100, ((index + 1) / total) * 100))}%`;
}

function hudText(text) {
  $('#hud-count').textContent = text;
}

function hideCountdown() {
  $('#countdown').hidden = true;
  $('#n-badge').hidden = false;
}

function showOverlay(reason) {
  $('#overlay-title').textContent = 'Paused';
  $('#overlay-sub').textContent = reason || 'Take a breath. The current item replays when you resume.';
  $('#board-overlay').hidden = false;
}

/** 3-2-1. Resolves true when it ran to the end, false when it was cancelled. */
async function countdown(my, from = 3) {
  const cd = $('#countdown');
  $('#n-badge').hidden = true;
  cd.hidden = false;
  const step = reduceMotion.matches ? 500 : 800;
  for (let i = from; i >= 1; i--) {
    cd.textContent = String(i);
    cd.style.animation = 'none';
    void cd.offsetWidth;
    cd.style.animation = '';
    sfx('tick');
    await sleep(step);
    if (my !== token) return false; // whoever cancelled us has already tidied the display
  }
  hideCountdown();
  sfx('go');
  return true;
}

/* ---------- start ---------- */
export async function startSession() {
  if (phase !== 'idle' || state.tutorialActive) return false;
  const my = ++token;
  setPhase('starting');
  const s = state.settings;
  const n = S.levelFor(s);

  await audio.unlock();
  if (!audio.sfxReady) audio.preloadSfx();
  if (s.sound && s.voice === 'recorded' && !audio.ready && !audio.failed) {
    toast('Loading voice…', 1200);
    const ok = await Promise.race([audio.preload(), sleep(4000).then(() => false)]);
    if (!ok && my === token) toast('Using device speech for letters', 2000);
  }
  if (my !== token) return false;

  sequence = G.generateSequence(n, { mode: s.mode, length: s.length });
  pausedMs = 0;
  setZones(sequence.streams);
  setBadge(n);
  $('#board-overlay').hidden = true;
  show('play');
  renderProgress(-1);
  hudText('Get ready');

  setPhase('countdown');
  if (!(await countdown(my))) return false;

  sessionStart = Date.now();
  runner = new Runner(sequence, { interval: s.interval, stimulusMs: s.stimulusMs }, {
    onTrialStart: (i, trial) => {
      lightCell(trial.values.position, sequence.streams.includes('color') ? trial.values.color : null);
      if (sequence.streams.includes('sound')) speakLetter(trial.values.sound);
      renderProgress(i);
      hudText(i < sequence.n ? `Memorize ${i + 1} of ${sequence.n}` : '');
    },
    onStimulusEnd: () => clearCells(),
    onTrialSettled: (i, missed) => {
      if (!missed.length || !state.settings.feedback) return;
      for (const stream of missed) flash(stream, 'missed', 600);
      buzz('missed');
      sfx('missed');
    },
    onFinish: finish,
  });
  setPhase('running');
  runner.start();
  return true;
}

/** Abandon a session that has not reached its first item yet. */
function cancelStart() {
  token++;
  hideCountdown();
  setPhase('idle');
  show('home');
}

/* ---------- input ---------- */
export function respond(stream) {
  if (phase !== 'running' || !runner) return;
  const res = runner.respond(stream);
  if (res.ignored || res.duplicate) return;
  pulsePress(stream);
  if (res.tooEarly) {
    const hud = $('#hud-count');
    hud.classList.remove('nudge');
    void hud.offsetWidth;
    hud.classList.add('nudge');
    buzz('tap');
    return;
  }
  if (state.settings.feedback) flash(stream, res.correct ? 'good' : 'bad');
  sfx(res.correct ? 'good' : 'bad');
  buzz(res.correct ? 'tap' : 'bad');
}

/* ---------- pause / resume / quit ---------- */
export function pauseSession(reason) {
  if (phase === 'starting' || phase === 'countdown') { cancelStart(); return; }
  if (phase === 'resuming') {
    token++;
    hideCountdown();
    showOverlay(reason);
    setPhase('paused');
    return;
  }
  if (phase !== 'running' || !runner) return;
  if (!runner.pause()) return; // the closing moment of the last item: let it finish
  pauseStartedAt = Date.now();
  clearCells();
  showOverlay(reason);
  setPhase('paused');
}

export async function resumeSession() {
  if (phase !== 'paused') return;
  const my = ++token;
  setPhase('resuming');
  $('#board-overlay').hidden = true;
  if (!(await countdown(my))) return;
  pausedMs += Date.now() - pauseStartedAt;
  setPhase('running');
  runner.resume();
}

export function togglePause() {
  if (phase === 'paused') resumeSession();
  else pauseSession();
}

export async function quitSession() {
  if (phase === 'idle') return;
  if (phase === 'starting' || phase === 'countdown') { cancelStart(); return; }
  if (phase === 'running' || phase === 'resuming') pauseSession('Paused while you decide.');
  if (phase !== 'paused') return;
  const ok = await confirmDialog('End this session?', 'Unfinished sessions are not recorded.', 'End session');
  if (!ok || phase !== 'paused') return; // stays paused; Resume is on screen
  abortSession();
  show('home');
}

/** Stop everything without recording. Safe to call in any phase. */
export function abortSession() {
  token++;
  if (runner) runner.stop();
  runner = null;
  hideCountdown();
  clearCells();
  $('#board-overlay').hidden = true;
  setPhase('idle');
}

/* ---------- finish ---------- */
function finish(responses) {
  const s = state.settings;
  const seq = sequence;
  const score = G.scoreBlock(seq, responses);
  const next = s.adaptive ? G.nextN(seq.n, score, { rule: s.progression }) : seq.n;
  const entry = {
    ts: Date.now(),
    n: seq.n,
    nextN: next,
    mode: seq.mode,
    length: s.length,
    trials: seq.trials.length,
    interval: s.interval,
    durationMs: Math.max(0, Date.now() - sessionStart - pausedMs),
    accuracy: score.accuracy,
    errors: score.errors,
    meanRt: score.meanRt,
    perStream: score.perStream,
  };
  state.history = S.appendHistory(entry);
  runner = null;
  clearCells();

  if (next !== seq.n) {
    S.setLevel(s, next, seq.mode); // each mode keeps its own level
    saveSettings();
  }

  const summary = ST.summarize(state.history);
  const fresh = evaluate({ summary, lastSession: entry, settings: s, history: state.history }, state.achievements);
  if (fresh.length) {
    S.saveAchievements(state.achievements);
    fresh.forEach((a, k) => setTimeout(() => { toast(`${a.icon} Achievement: ${a.title}`); sfx('achievement'); }, 900 + k * 2800));
  }

  setPhase('idle');
  setBadge(S.levelFor(s));
  buzz(next > seq.n ? 'levelup' : 'done');
  sfx(next > seq.n ? 'levelup' : 'complete');
  armReminders(); // today is done: the next reminder moves to tomorrow
  if (finishedHandler) finishedHandler(entry, score);
}
