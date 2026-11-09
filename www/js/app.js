import * as G from './game.js';
import { LetterAudio } from './audio.js';
import { watchPosture } from './posture.js';
import * as S from './storage.js';
import * as ST from './stats.js';
import { ACHIEVEMENTS, evaluate } from './achievements.js';
import { lineChart, barChart, heatmap, ring } from './charts.js';
import * as R from './reminders.js';
import { createTutorial } from './tutorial.js';
import { setExternalSegments } from './posture.js';
import * as N from './native.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = document.documentElement;
const app = $('#app');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  settings: S.loadSettings(),
  history: S.loadHistory(),
  achievements: S.loadAchievements(),
  meta: S.loadMeta(),
  screen: 'home',
  previousScreen: 'home',
  runner: null,
  sequence: null,
  sessionStart: 0,
  pausedMs: 0,
  posture: null,
  historyShown: 15,
  tutorial: null,
  lastResult: null,
};
const audio = new LetterAudio(G.LETTERS, 'audio/');

/* ------------------------------------------------------------------ */
/* Runner: timing for one block                                        */
/* ------------------------------------------------------------------ */
const GRACE_MS = 300; // a press this soon after a new item still counts for the previous one

class Runner {
  constructor(sequence, { interval, stimulusMs }, hooks) {
    this.seq = sequence;
    this.interval = interval;
    this.stimulusMs = stimulusMs;
    this.hooks = hooks;
    this.index = -1;
    this.responses = [];
    this.timers = [];
    this.paused = false;
    this.finished = false;
    this.onsetAt = 0;
    this.stimulusShown = false;
    this.stimulusHidden = false;
  }

  start() { this.next(); }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  next() {
    this.clearTimers();
    this.index++;
    if (this.index >= this.seq.trials.length) {
      this.finished = true;
      this.hooks.onFinish(this.responses);
      return;
    }
    this.responses[this.index] = {};
    this.onsetAt = performance.now();
    this.stimulusShown = true;
    this.stimulusHidden = false;
    this.hooks.onTrialStart(this.index, this.seq.trials[this.index]);
    this.armTimers(this.stimulusMs, this.interval);
  }

  armTimers(stimulusLeft, trialLeft) {
    if (!this.stimulusHidden) {
      this.timers.push(setTimeout(() => {
        this.stimulusHidden = true;
        this.hooks.onStimulusEnd(this.index);
      }, Math.max(0, stimulusLeft)));
    }
    this.timers.push(setTimeout(() => this.endTrial(), Math.max(0, trialLeft)));
  }

  endTrial() {
    const trial = this.seq.trials[this.index];
    const r = this.responses[this.index] || {};
    const missed = this.index >= this.seq.n
      ? this.seq.streams.filter(s => trial.match[s] && r[s] == null)
      : [];
    this.hooks.onTrialEnd(this.index, missed);
    this.next();
  }

  respond(stream) {
    if (this.paused || this.finished || this.index < 0) return { ignored: true };
    const sinceOnset = performance.now() - this.onsetAt;
    // Late reaction to the previous item: within the grace window, the previous
    // item had a target in this stream, and it was not answered yet.
    if (sinceOnset < GRACE_MS && this.index - 1 >= this.seq.n) {
      const prev = this.responses[this.index - 1];
      const prevTrial = this.seq.trials[this.index - 1];
      if (prev && prev[stream] == null && prevTrial.match[stream]) {
        prev[stream] = Math.round(this.interval + sinceOnset);
        return { correct: true, rt: prev[stream], late: true };
      }
    }
    if (this.index < this.seq.n) return { tooEarly: true };
    const r = this.responses[this.index];
    if (r[stream] != null) return { duplicate: true };
    const rt = Math.round(sinceOnset);
    r[stream] = rt;
    return { correct: Boolean(this.seq.trials[this.index].match[stream]), rt };
  }

  pause() {
    if (this.paused || this.finished || this.index < 0) return;
    this.paused = true;
    this.pausedAt = performance.now();
    this.clearTimers();
  }

  /** Resume the current trial where it left off. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    const elapsed = this.pausedAt - this.onsetAt;
    this.onsetAt = performance.now() - elapsed;
    const trialLeft = Math.max(700, this.interval - elapsed);
    if (!this.stimulusHidden) {
      this.hooks.onTrialStart(this.index, this.seq.trials[this.index], true);
      this.armTimers(Math.max(250, this.stimulusMs - elapsed), trialLeft);
    } else {
      this.armTimers(0, trialLeft);
    }
  }

  stop() {
    this.clearTimers();
    this.finished = true;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function buzz(pattern) {
  if (!state.settings.haptics) return;
  if (N.isNative) {
    const kind = Array.isArray(pattern) ? (pattern.length > 3 ? 'levelup' : 'bad') : pattern >= 40 ? 'missed' : pattern >= 20 ? 'good' : 'tap';
    N.haptic(kind);
    return;
  }
  if (!navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

function confirmDialog(title, text, okLabel = 'Confirm') {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MODE_LABEL = { position: 'Position', sound: 'Sound', dual: 'Dual', triple: 'Triple' };
const STREAM_KEYS = { position: 'A', color: 'F', sound: 'L' };

function saveSettings() {
  S.saveSettings(state.settings);
}

function applySettings() {
  const s = state.settings;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = s.theme;
  root.dataset.palette = s.palette;
  root.dataset.handed = s.handed;
  root.dataset.hinge = s.hingeAware ? 'on' : 'off';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--accent').trim() || '#7c5cff');
  audio.setVolume(s.volume);
  audio.setMuted(!s.sound);
  $('#n-num').textContent = s.n;
  renderHome();
  renderSettings();
  if (N.isNative) {
    const trainedToday = state.history.some(h => S.dayKey(h.ts) === S.dayKey());
    if (s.reminders.enabled) N.scheduleReminder(s.reminders.time, trainedToday); else N.cancelReminder();
    N.setStatusBar(root.dataset.theme === 'dark' || (s.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  }
  R.schedule(s, () => state.history, onReminderFired);
  R.syncConfig({
    enabled: s.reminders.enabled,
    time: s.reminders.time,
    lastSessionDay: state.history.length ? S.dayKey(state.history[state.history.length - 1].ts) : null,
    lastNotifiedDay: state.meta.lastNotifiedDay || null,
  });
}

function onReminderFired(day) {
  state.meta.lastNotifiedDay = day;
  S.saveMeta(state.meta);
}

/* ------------------------------------------------------------------ */
/* screens                                                             */
/* ------------------------------------------------------------------ */
function show(screen) {
  if (screen !== state.screen) state.previousScreen = state.screen;
  state.screen = screen;
  app.dataset.screen = screen;
  for (const v of $$('.view')) v.hidden = !v.classList.contains(`view-${screen}`);
  const playing = screen === 'play';
  $('#hud').hidden = !playing;
  $('#actions').hidden = !playing;
  if (!playing) { $('#coach').hidden = true; app.dataset.tutorial = 'off'; }
  if (screen !== 'results') $('#confetti').hidden = true;
  $('#btn-back').hidden = !(screen === 'stats' || screen === 'settings');
  $('#topbar-actions').hidden = playing;
  $('#brand-text').textContent = screen === 'stats' ? 'Progress' : screen === 'settings' ? 'Settings' : screen === 'results' ? 'Results' : 'NBack';
  const useAlt = screen === 'stats' || screen === 'results';
  $('#board').hidden = useAlt;
  $('#stage-alt').hidden = !useAlt;
  $('#board').classList.toggle('dim', screen === 'settings');
  if (screen === 'home') renderHome();
  if (screen === 'stats') renderStats();
  if (screen === 'settings') renderSettings();
  if (screen !== 'play') $('#panel').scrollTop = 0;
}

/* ------------------------------------------------------------------ */
/* home                                                                */
/* ------------------------------------------------------------------ */
function sessionMeta(s = state.settings) {
  const trials = G.trialsForN(s.n, s.length);
  const secs = Math.round((trials * s.interval) / 1000);
  const mins = Math.max(1, Math.round(secs / 60));
  return `${MODE_LABEL[s.mode]} · ${s.n}-back · ${trials} trials · about ${mins} min`;
}

function renderHome() {
  const s = state.settings;
  const sum = ST.summarize(state.history);
  $('#home-n').textContent = s.n;
  $('#n-num').textContent = s.n;
  const pill = $('#adaptive-pill');
  pill.textContent = s.adaptive ? 'Adaptive' : 'Manual';
  pill.classList.toggle('off', !s.adaptive);
  for (const chip of $$('#mode-chips .chip')) chip.setAttribute('aria-checked', String(chip.dataset.mode === s.mode));
  $('#start-meta').textContent = sessionMeta();

  const goal = s.dailyGoal;
  $('#today-ring').innerHTML = ring({
    value: sum.todayCount, max: Math.max(goal, 1), size: 92, stroke: 10,
    label: goal > 0 ? `${sum.todayCount}/${goal}` : String(sum.todayCount), sublabel: 'today',
  });
  $('#today-sub').textContent = goal > 0
    ? (sum.todayCount >= goal ? 'Daily goal done' : `${goal - sum.todayCount} more to reach your goal`)
    : `${sum.todayCount} session${sum.todayCount === 1 ? '' : 's'} today`;
  $('#streak-text').textContent = sum.streak > 0 ? `🔥 ${sum.streak}-day streak` : 'Start a streak today';

  const last = sum.last;
  const card = $('#last-card');
  if (last) {
    card.hidden = false;
    const delta = last.nextN - last.n;
    card.innerHTML = `<div><div class="muted">Last session</div><div class="big">${last.n}-back · ${Math.round(last.accuracy * 100)}%</div></div>
      <div style="text-align:right"><div class="muted">${new Date(last.ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>
      <div class="big" style="color:${delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--bad)' : 'var(--muted)'}">${delta > 0 ? '▲ level up' : delta < 0 ? '▼ level down' : '● steady'}</div></div>`;
  } else {
    card.hidden = true;
  }
  $('#home-insight').textContent = ST.insights(sum, state.history, s)[0] || '';
  $('#btn-video-home').hidden = Boolean(state.meta.watchedVideo) || sum.sessions >= 8;
}

/* ------------------------------------------------------------------ */
/* play                                                                */
/* ------------------------------------------------------------------ */
const cells = $$('#board .cell');

function clearCells() {
  for (const c of cells) {
    c.classList.remove('lit');
    c.style.removeProperty('--cell-color');
    const name = c.querySelector('.color-name');
    if (name) name.remove();
  }
}

function lightCell(trial) {
  clearCells();
  const cell = cells[trial.values.position];
  if (state.sequence.streams.includes('color')) {
    const color = G.COLORS[trial.values.color];
    cell.style.setProperty('--cell-color', color.hex);
    if (state.settings.colorNames) {
      const span = document.createElement('span');
      span.className = 'color-name';
      span.textContent = color.name;
      cell.appendChild(span);
    }
  }
  cell.classList.add('lit');
}

function renderProgress(index) {
  const total = state.sequence.trials.length;
  const pct = Math.max(0, Math.min(100, ((index + 1) / total) * 100));
  $('#progress-fill').style.width = `${pct}%`;
}

function hudText(index) {
  const n = state.sequence.n;
  const total = state.sequence.trials.length;
  const el = $('#hud-count');
  el.textContent = index < n ? `Memorize ${index + 1} of ${n}` : '';
}

function flash(stream, cls, ms = 380) {
  const btn = $(`.action[data-stream="${stream}"]`);
  if (!btn) return;
  btn.classList.remove('good', 'bad', 'missed');
  void btn.offsetWidth; // restart the animation
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), ms);
}

async function countdown(from = 3) {
  const cd = $('#countdown');
  const badge = $('#n-badge');
  badge.hidden = true;
  cd.hidden = false;
  const step = reduceMotion.matches ? 500 : 800;
  for (let i = from; i >= 1; i--) {
    cd.textContent = String(i);
    cd.style.animation = 'none';
    void cd.offsetWidth;
    cd.style.animation = '';
    if (state.settings.tones) audio.sfx('tick');
    await new Promise(r => setTimeout(r, step));
    if (state.screen !== 'play') break;
  }
  cd.hidden = true;
  badge.hidden = false;
  if (state.settings.tones && state.screen === 'play') audio.sfx('go');
}

async function startSession() {
  const s = state.settings;
  await audio.unlock();
  if (!audio.sfxReady) audio.preloadSfx();
  if (s.sound && s.voice === 'recorded' && !audio.ready && !audio.failed) {
    toast('Loading voice…', 1200);
    const ok = await Promise.race([audio.preload(), new Promise(r => setTimeout(() => r(false), 4000))]);
    if (!ok) toast('Using device speech for letters', 2000);
  }
  state.sequence = G.generateSequence(s.n, { mode: s.mode, length: s.length });
  state.errorsAt = new Set();
  state.pausedMs = 0;
  for (const btn of $$('.action')) {
    btn.hidden = !state.sequence.streams.includes(btn.dataset.stream);
    btn.classList.remove('good', 'bad', 'missed');
  }
  $('#board-overlay').hidden = true;
  show('play');
  renderProgress(-1);
  $('#hud-count').textContent = 'Get ready';
  await countdown(3);
  if (state.screen !== 'play') return;
  state.sessionStart = Date.now();
  state.runner = new Runner(state.sequence, { interval: s.interval, stimulusMs: s.stimulusMs }, {
    onTrialStart: (i, trial, replay) => {
      lightCell(trial);
      if (!replay && state.sequence.streams.includes('sound')) {
        if (s.voice === 'device') audio.speak(trial.values.sound);
        else audio.play(trial.values.sound);
      }
      renderProgress(i);
      hudText(i);
    },
    onStimulusEnd: () => clearCells(),
    onTrialEnd: (i, missed) => {
      if (missed.length) {
        state.errorsAt.add(i);
        if (s.feedback) {
          for (const m of missed) flash(m, 'missed', 600);
          buzz(40);
          if (s.tones) audio.sfx('missed');
        }
      }
    },
    onFinish: finishSession,
  });
  state.runner.start();
}

function respond(stream) {
  if (state.tutorial) {
    const btn = $(`.action[data-stream="${stream}"]`);
    if (btn && !btn.hidden) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); buzz(12); state.tutorial.press(stream); }
    return;
  }
  const runner = state.runner;
  if (!runner || state.screen !== 'play') return;
  const res = runner.respond(stream);
  const btn = $(`.action[data-stream="${stream}"]`);
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
  if (res.tooEarly) {
    const hud = $('#hud-count');
    hud.classList.remove('nudge');
    void hud.offsetWidth;
    hud.classList.add('nudge');
    buzz(15);
    return;
  }
  if (res.ignored || res.duplicate) return;
  if (res.late) state.errorsAt.delete(runner.index - 1);
  if (state.settings.feedback) {
    flash(stream, res.correct ? 'good' : 'bad');
    if (!res.correct) state.errorsAt.add(runner.index);
  }
  if (state.settings.tones) audio.sfx(res.correct ? 'good' : 'bad');
  buzz(res.correct ? 12 : [30, 40, 30]);
}

function pauseSession(reason) {
  const runner = state.runner;
  if (!runner || runner.paused || runner.finished || state.screen !== 'play') return;
  runner.pause();
  state.pauseStartedAt = Date.now();
  clearCells();
  $('#overlay-title').textContent = 'Paused';
  $('#overlay-sub').textContent = reason || 'Take a breath. The current item replays when you resume.';
  $('#board-overlay').hidden = false;
}

async function resumeSession() {
  const runner = state.runner;
  if (!runner || !runner.paused) return;
  $('#board-overlay').hidden = true;
  await countdown(3);
  if (state.screen !== 'play' || !state.runner) return;
  state.pausedMs += Date.now() - state.pauseStartedAt;
  runner.resume();
}

async function quitSession() {
  const runner = state.runner;
  if (!runner) return;
  const wasPaused = runner.paused;
  if (!wasPaused) runner.pause();
  const ok = await confirmDialog('End this session?', 'Unfinished sessions are not recorded.', 'End session');
  if (!ok) {
    if (!wasPaused) runner.resume();
    return;
  }
  runner.stop();
  state.runner = null;
  clearCells();
  $('#board-overlay').hidden = true;
  show('home');
}

function finishSession(responses) {
  const seq = state.sequence;
  const s = state.settings;
  const score = G.scoreBlock(seq, responses);
  const scorable = seq.trials.length - seq.n;
  const next = s.adaptive ? G.nextN(seq.n, score.errors, { scorable, rule: s.progression, accuracy: score.accuracy }) : seq.n;
  const entry = {
    ts: Date.now(),
    n: seq.n,
    nextN: next,
    mode: seq.mode,
    length: s.length,
    trials: seq.trials.length,
    interval: s.interval,
    durationMs: Math.max(0, Date.now() - state.sessionStart - state.pausedMs),
    accuracy: score.accuracy,
    errors: score.errors,
    meanRt: score.meanRt,
    perStream: score.perStream,
  };
  state.history = S.appendHistory(entry);
  state.runner = null;
  clearCells();

  if (s.adaptive && next !== s.n) {
    s.n = next;
    saveSettings();
  }
  const sum = ST.summarize(state.history);
  const fresh = evaluate({ summary: sum, lastSession: entry, settings: s, history: state.history }, state.achievements);
  if (fresh.length) {
    S.saveAchievements(state.achievements);
    let delay = 600;
    for (const a of fresh) {
      setTimeout(() => { toast(`${a.icon} Achievement: ${a.title}`); if (s.tones) audio.sfx('achievement'); }, delay);
      delay += 2800;
    }
  }
  renderResults(entry, score);
  show('results');
  $('#n-num').textContent = s.n;
  buzz(next > entry.n ? [20, 30, 20, 30, 60] : 20);
  if (s.tones) audio.sfx(next > entry.n ? 'levelup' : 'complete');
  applySettings();
}

/* ------------------------------------------------------------------ */
/* tutorial                                                            */
/* ------------------------------------------------------------------ */
const narration = { el: null, timer: null, key: null };

function stopNarration() {
  clearTimeout(narration.timer);
  narration.timer = null;
  if (narration.el) {
    narration.el.pause();
    narration.el.onended = null;
    narration.el = null;
  }
  $('#coach-voice').classList.remove('speaking');
}

function narrate(key, delay = 0) {
  stopNarration();
  narration.key = key;
  if (!key || !state.settings.tutorialVoice) return;
  const play = () => {
    const el = new Audio(`audio/tutorial/${key}.mp3`);
    el.volume = Math.min(1, state.settings.volume);
    narration.el = el;
    $('#coach-voice').classList.add('speaking');
    el.onended = () => { $('#coach-voice').classList.remove('speaking'); if (narration.el === el) narration.el = null; };
    el.play().catch(() => { $('#coach-voice').classList.remove('speaking'); });
  };
  if (delay > 0) narration.timer = setTimeout(play, delay);
  else play();
}

/** Run `cb` when the current narration finishes; with voice off, after `fallbackMs`. */
function afterVoice(cb, fallbackMs = 1000) {
  const el = narration.el;
  const pending = narration.timer != null;
  if (!state.settings.tutorialVoice || (!el && !pending)) { setTimeout(cb, fallbackMs); return; }
  let done = false;
  const fire = () => { if (done) return; done = true; cb(); };
  const safety = setTimeout(fire, 25000);
  const watch = () => {
    const cur = narration.el;
    if (!cur) { setTimeout(() => { if (narration.el) watch(); else { clearTimeout(safety); setTimeout(fire, 400); } }, 300); return; }
    const prev = cur.onended;
    cur.onended = (ev) => { if (prev) prev(ev); clearTimeout(safety); setTimeout(fire, 500); };
    cur.onerror = () => { clearTimeout(safety); fire(); };
  };
  watch();
}

function openVideo() {
  for (const dlg of $$('dialog[open]')) if (dlg.id !== 'dlg-video') dlg.close();
  if (state.runner) pauseSession();
  const dlg = $('#dlg-video');
  dlg.showModal();
  const vid = $('#video-2back');
  vid.currentTime = 0;
  vid.play().catch(() => {});
}

function renderVoiceToggle() {
  const btn = $('#coach-voice');
  const on = state.settings.tutorialVoice;
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Voice-over on' : 'Voice-over off');
}

async function startTutorial() {
  if (state.runner) { state.runner.stop(); state.runner = null; }
  await audio.unlock();
  if (!audio.sfxReady) audio.preloadSfx();
  if (!audio.ready && !audio.failed) await Promise.race([audio.preload(), new Promise(r => setTimeout(r, 2500))]);
  for (const dlg of $$('dialog[open]')) dlg.close();
  show('play');
  app.dataset.tutorial = 'on';
  $('#coach').hidden = false;
  $('#board-overlay').hidden = true;
  for (const btn of $$('.action')) { btn.hidden = btn.dataset.stream === 'color'; btn.classList.remove('good', 'bad', 'missed', 'hint'); }
  const ui = {
    light: (pos, letter) => {
      clearCells();
      cells[pos].classList.add('lit');
      if (state.settings.sound) { if (state.settings.voice === 'device') audio.speak(letter); else audio.play(letter); }
    },
    clear: () => clearCells(),
    hint: (streams) => { for (const btn of $$('.action')) btn.classList.toggle('hint', streams.includes(btn.dataset.stream)); },
    coach: ({ step, steps, title, text, button, onButton, voice, voiceDelay }) => {
      narrate(voice, voiceDelay);
      $('#coach-steps').innerHTML = Array.from({ length: steps }, (_, i) => `<i class="${i <= step ? 'done' : ''}"></i>`).join('');
      $('#coach-title').textContent = title;
      $('#coach-text').textContent = text;
      const next = $('#coach-next');
      next.hidden = !button;
      next.textContent = button || 'Next';
      next.onclick = onButton || null;
    },
    feedback: (stream, ok) => { if (state.settings.feedback) flash(stream, ok ? 'good' : 'bad'); buzz(ok ? 12 : [30, 40, 30]); },
    sfx: (kind) => { if (state.settings.tones) audio.sfx(kind); },
    badge: (n) => { $('#n-num').textContent = n; },
    afterVoice: (cb, fallbackMs) => afterVoice(cb, fallbackMs),
    done: (reason) => endTutorial(reason),
  };
  renderVoiceToggle();
  state.tutorial = createTutorial(ui);
  state.tutorial.start();
}

function endTutorial(reason) {
  stopNarration();
  state.tutorial = null;
  app.dataset.tutorial = 'off';
  $('#coach').hidden = true;
  for (const btn of $$('.action')) btn.classList.remove('hint', 'good', 'bad', 'missed');
  clearCells();
  S.setOnboarded();
  $('#n-num').textContent = state.settings.n;
  show('home');
  toast(reason === 'completed' ? 'Tutorial complete. Ready for a real session!' : 'Tutorial skipped. Find it again under Settings → Learn.', 3200);
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */
const STREAM_SHORT = { position: 'Position', sound: 'Sound', color: 'Color' };

function headlineFor(entry, score) {
  const delta = entry.nextN - entry.n;
  const gap = G.levelUpGap(score.errors, score.accuracy, { rule: state.settings.progression, scorable: entry.trials - entry.n });
  const closeness = gap.kind === 'errors'
    ? (gap.gap === 0 ? '' : gap.gap === 1 ? 'One fewer error next time levels you up' : `${gap.gap} fewer errors next time levels you up`)
    : (gap.gap === 0 ? '' : `${Math.ceil(gap.gap * 100)} more points of accuracy levels you up`);
  if (delta > 0) return ['Awesome!', `You move up to ${entry.nextN}-back`];
  if (!state.settings.adaptive) return [score.accuracy >= 0.85 ? 'Excellent!' : 'Nice work!', `${entry.n}-back · ${score.errors} error${score.errors === 1 ? '' : 's'}`];
  if (delta < 0) return ['Keep going!', `Back to ${entry.nextN}-back to build a base`];
  if (score.accuracy >= 0.85) return ['So close!', closeness || `Strong round at ${entry.n}-back`];
  if (score.accuracy >= 0.6) return ['Nice work!', closeness || `Holding steady at ${entry.n}-back`];
  return ['Good effort!', 'Every round builds the skill'];
}

function pointsFor(entry, score) {
  // accuracy weighted by level, so a clean 3-back is worth more than a clean 1-back
  return Math.round(score.accuracy * 100 * entry.n);
}

function renderResults(entry, score) {
  const delta = entry.nextN - entry.n;
  const [headline, sub] = headlineFor(entry, score);
  const pct = Math.round(score.accuracy * 100);
  const colorOf = st => `var(--series-${st})`;

  $('#stage-alt').innerHTML = `<div class="res-hero">
      ${ring({ value: score.accuracy, max: 1, size: 150, stroke: 13, color: delta > 0 ? 'var(--good)' : 'var(--accent)', label: `${pct}%`, sublabel: 'correct' })}
      <div>
        <div class="headline">${headline}</div>
        <div class="sub">${sub}</div>
        <div class="points">${pointsFor(entry, score)} <span>points</span></div>
      </div>
    </div>`;

  $('#res-tiles').innerHTML = `
    <div class="tile"><b>${entry.n}</b><span>N level</span></div>
    <div class="tile"><b>${Math.round(entry.durationMs / 1000)} s</b><span>play time</span></div>
    <div class="tile"><b>${(entry.interval / 1000).toFixed(1)} s</b><span>interval</span></div>`;

  const streams = score.streams;
  const row = (label, key, badWhenPositive) => `<tr><td>${label}</td>${streams.map((st) => {
    const v = score.perStream[st][key];
    const cls = v === 0 ? 'zero' : badWhenPositive ? 'bad' : '';
    return `<td class="v ${cls}">${v}</td>`;
  }).join('')}</tr>`;
  $('#res-streams').innerHTML = `<table class="stream-table">
    <thead><tr><th>Stream</th>${streams.map(st => `<th class="s"><span class="pct" style="color:${colorOf(st)}">${Math.round(score.perStream[st].accuracy * 100)}%</span>${STREAM_SHORT[st]}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('Correct', 'hits', false)}
      ${row('Missed match', 'misses', true)}
      ${row('False tap', 'falseAlarms', true)}
      <tr><td>Reaction</td>${streams.map(st => `<td class="v ${score.perStream[st].meanRt == null ? 'zero' : ''}">${score.perStream[st].meanRt != null ? `${score.perStream[st].meanRt} ms` : '—'}</td>`).join('')}</tr>
    </tbody></table>`;

  $('#btn-again').innerHTML = delta > 0 ? `<span>Play again at ${entry.nextN}-back</span>` : delta < 0 ? `<span>Play again at ${entry.nextN}-back</span>` : '<span>Play again</span>';
  state.lastResult = { entry, score, headline };
  if (delta > 0 && !reduceMotion.matches) confetti();
}

function shareResults() {
  const r = state.lastResult;
  if (!r) return;
  const { entry, score } = r;
  const lines = [
    `NBack Trainer: ${MODE_LABEL[entry.mode]} ${entry.n}-back, ${Math.round(score.accuracy * 100)}% correct, ${pointsFor(entry, score)} points.`,
    ...score.streams.map(st => `${STREAM_SHORT[st]} ${Math.round(score.perStream[st].accuracy * 100)}% (${score.perStream[st].hits} correct, ${score.perStream[st].misses} missed, ${score.perStream[st].falseAlarms} false)`),
  ];
  if (entry.nextN > entry.n) lines.push(`Level up to ${entry.nextN}-back!`);
  const text = lines.join('\n');
  if (navigator.share) {
    navigator.share({ title: 'NBack Trainer results', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Results copied to the clipboard')).catch(() => toast('Could not share on this device'));
  } else {
    toast('Sharing is not available here');
  }
}

/** Lightweight confetti burst on the stage canvas. */
function confetti() {
  const canvas = $('#confetti');
  const stage = $('#stage');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.hidden = false;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(root);
  const colors = ['--accent', '--accent-2', '--accent-3', '--series-position', '--series-sound', '--series-color'].map(v => cs.getPropertyValue(v).trim());
  const parts = Array.from({ length: 90 }, () => ({
    x: Math.random() * w, y: -10 - Math.random() * h * 0.5,
    vx: (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random() * 2.5,
    r: 4 + Math.random() * 5, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)], shape: Math.random() < 0.3 ? 'circle' : 'rect',
  }));
  const start = performance.now();
  const duration = 2600;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.02;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r / 1.5);
      ctx.restore();
    }
    if (t < duration && state.screen === 'results') requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, h); canvas.hidden = true; }
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */
function renderStats() {
  const h = state.history;
  const s = state.settings;
  const sum = ST.summarize(h);
  const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
  $('#stats-tiles').innerHTML = [
    [sum.sessions, 'sessions'],
    [sum.currentN != null ? `${sum.currentN}` : s.n, 'current N'],
    [sum.bestN || '—', 'best N'],
    [pct(sum.avgAcc7), '7-day acc.'],
    [`${sum.streak}🔥`, 'streak'],
    [sum.totalMs ? ST.formatDuration(sum.totalMs) : '0 min', 'trained'],
  ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

  // hero chart in the stage (top screen when half-open)
  const alt = $('#stage-alt');
  alt.innerHTML = '<div class="card" style="width:100%;height:100%;display:grid;grid-template-rows:auto 1fr;gap:4px;padding:12px 14px"><div><b>Level over time</b> <span class="muted">· last 30 sessions</span></div><div id="chart-hero" class="chart-box" style="min-height:0"></div></div>';
  requestAnimationFrame(() => {
    const hero = $('#chart-hero');
    const hh = Math.max(90, hero.clientHeight || 120);
    lineChart(hero, { series: [{ key: 'n', name: 'N', points: ST.nTrend(h) }], count: Math.min(30, Math.max(2, h.length)), yMin: 1, yMax: Math.max(4, sum.bestN + 1), yTicks: Math.min(4, Math.max(2, sum.bestN)), yFormat: v => String(Math.round(v)), height: hh, step: true });
    lineChart($('#chart-n'), { series: [{ key: 'n', name: 'N', points: ST.nTrend(h) }], count: Math.min(30, Math.max(2, h.length)), yMin: 1, yMax: Math.max(4, sum.bestN + 1), yTicks: Math.min(4, Math.max(2, sum.bestN)), yFormat: v => String(Math.round(v)), height: 170, step: true });
    const acc = ST.accuracyTrend(h);
    $('#legend-acc').innerHTML = acc.series.map(sr => `<span><span class="dot" style="background:var(--series-${sr.key})"></span>${sr.name}</span>`).join('');
    lineChart($('#chart-acc'), { series: acc.series, count: Math.max(2, acc.count), yMin: 0, yMax: 100, yTicks: 4, yFormat: v => `${Math.round(v)}%`, height: 170 });
    barChart($('#chart-days'), { bars: ST.dailyCounts(h, 14), goal: s.dailyGoal, height: 140 });
    heatmap($('#chart-heat'), { byDay: sum.byDay, weeks: 12, dayKeyFn: S.dayKey });
  });

  $('#insights').innerHTML = ST.insights(sum, h, s).map(t => `<li>${t}</li>`).join('');

  const rec = [];
  rec.push(['Best level', sum.bestN ? `${sum.bestN}-back` : '—']);
  rec.push(['Best accuracy', h.length ? pct(sum.bestAccuracy) : '—']);
  rec.push(['Longest streak', `${sum.longestStreak} day${sum.longestStreak === 1 ? '' : 's'}`]);
  rec.push(['Most in a day', `${sum.mostInDay} session${sum.mostInDay === 1 ? '' : 's'}`]);
  rec.push(['Fastest average reaction', sum.fastestRt != null ? `${sum.fastestRt} ms` : '—']);
  rec.push(['Flawless sessions', String(sum.perfectSessions)]);
  for (const st of ['position', 'sound', 'color']) {
    if (sum.streamAcc[st] != null) rec.push([`${ST.STREAM_LABELS[st]} accuracy (last 20)`, pct(sum.streamAcc[st])]);
  }
  $('#records').innerHTML = rec.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const unlocked = Object.keys(state.achievements).length;
  $('#ach-count').textContent = `${unlocked} / ${ACHIEVEMENTS.length}`;
  $('#achievements').innerHTML = ACHIEVEMENTS.map((a) => {
    const when = state.achievements[a.id];
    return `<div class="ach ${when ? '' : 'locked'}" title="${a.desc}"><span class="ico">${a.icon}</span>${a.title}<small>${when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : a.desc}</small></div>`;
  }).join('');

  renderHistoryList();
}

function renderHistoryList() {
  const h = state.history;
  const list = $('#history-list');
  const recent = h.slice().reverse().slice(0, state.historyShown);
  if (!recent.length) {
    list.innerHTML = '<p class="hint">No sessions yet.</p>';
    $('#btn-history-more').hidden = true;
    return;
  }
  list.innerHTML = recent.map((e) => {
    const d = e.nextN - e.n;
    const arrow = d > 0 ? '<span class="up">▲</span>' : d < 0 ? '<span class="down">▼</span>' : '<span class="muted">●</span>';
    const streams = Object.keys(e.perStream || {}).map(s => `${ST.STREAM_LABELS[s][0]} ${Math.round(e.perStream[s].accuracy * 100)}%`).join(' · ');
    return `<div class="hrow"><div class="hn">${e.n}</div>
      <div><div>${MODE_LABEL[e.mode] || e.mode} · ${streams}</div><div class="hdate">${new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${Math.round((e.durationMs || 0) / 1000)} s${e.meanRt != null ? ` · ${e.meanRt} ms` : ''}</div></div>
      <div class="hacc">${Math.round(e.accuracy * 100)}% ${arrow}</div></div>`;
  }).join('');
  $('#btn-history-more').hidden = h.length <= state.historyShown;
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
  o[keys[keys.length - 1]] = value;
}

function renderSettings() {
  const s = state.settings;
  for (const el of $$('[data-setting]')) {
    const v = getPath(s, el.dataset.setting);
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = v;
  }
  $('#interval-val').textContent = `${(s.interval / 1000).toFixed(1)} s`;
  $('#stimulus-val').textContent = `${(s.stimulusMs / 1000).toFixed(2).replace(/0$/, '')} s`;
  for (const sw of $$('.swatch')) sw.setAttribute('aria-checked', String(sw.dataset.palette === s.palette));
  renderReminderStatus();
  const p = state.posture;
  if (p) $('#posture-debug').textContent = `Layout: ${p.posture}, ${p.layout}, ${p.width} · ${window.innerWidth}×${window.innerHeight}`;
}

function renderReminderStatus() {
  const s = state.settings;
  const el = $('#reminder-status');
  const sup = R.support();
  const perm = R.permission();
  if (!s.reminders.enabled) {
    el.textContent = 'Off. Turn it on and allow notifications when asked.';
  } else if (N.isNative) {
    const next = new Date(R.nextFireTime(s.reminders.time));
    el.textContent = `Scheduled on this device for ${next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}, then daily. It moves to the next day once you have trained.`;
  } else if (!sup.notifications) {
    el.textContent = 'This browser cannot show notifications. Use "Add to calendar" for a reliable daily alarm.';
  } else if (perm === 'denied') {
    el.textContent = 'Notifications are blocked for this site. Allow them in the browser settings, or use "Add to calendar".';
  } else if (perm !== 'granted') {
    el.textContent = 'Waiting for notification permission.';
  } else {
    const next = new Date(R.nextFireTime(s.reminders.time));
    const bg = sup.periodicSync ? 'Installed as an app, it can also remind you while closed.' : 'It fires while the app is open; add the calendar event too for a guaranteed alarm.';
    el.textContent = `Next reminder ${next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}, skipped on days you already trained. ${bg}`;
  }
}

async function onSettingChange(el) {
  const path = el.dataset.setting;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'range' || el.type === 'number') value = Number(el.value);
  else value = el.value;
  if (path === 'n') value = Math.min(9, Math.max(1, Math.round(value || 1)));
  if (path === 'dailyGoal') value = Math.min(30, Math.max(0, Math.round(value || 0)));
  setPath(state.settings, path, value);
  if (path === 'reminders.enabled' && value) {
    const perm = N.isNative ? await N.notificationPermission(true) : await R.requestPermission();
    if (perm !== 'granted') toast('Notifications were not allowed. The calendar option still works.', 3500);
  }
  saveSettings();
  applySettings();
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */
function bind() {
  $('#btn-start').addEventListener('click', startSession);
  $('#btn-again').addEventListener('click', startSession);
  $('#btn-home').addEventListener('click', () => show('home'));
  $('#btn-share').addEventListener('click', shareResults);
  $('#btn-back').addEventListener('click', () => show('home'));
  $('#nav-stats').addEventListener('click', () => show(state.screen === 'stats' ? 'home' : 'stats'));
  $('#nav-settings').addEventListener('click', () => show(state.screen === 'settings' ? 'home' : 'settings'));
  $('#nav-help').addEventListener('click', () => $('#dlg-howto').showModal());
  $('#btn-pause').addEventListener('click', () => pauseSession());
  $('#btn-resume').addEventListener('click', resumeSession);
  $('#btn-quit').addEventListener('click', quitSession);

  for (const btn of $$('.action')) {
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      ev.preventDefault();
      respond(btn.dataset.stream);
    });
    btn.addEventListener('click', ev => ev.preventDefault());
    btn.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  for (const chip of $$('#mode-chips .chip')) {
    chip.addEventListener('click', () => {
      state.settings.mode = chip.dataset.mode;
      saveSettings();
      applySettings();
    });
  }
  $('#n-minus').addEventListener('click', () => { state.settings.n = Math.max(1, state.settings.n - 1); saveSettings(); applySettings(); });
  $('#n-plus').addEventListener('click', () => { state.settings.n = Math.min(9, state.settings.n + 1); saveSettings(); applySettings(); });
  $('#adaptive-pill').addEventListener('click', () => { state.settings.adaptive = !state.settings.adaptive; saveSettings(); applySettings(); toast(state.settings.adaptive ? 'Adaptive N on' : 'Manual N'); });

  for (const el of $$('[data-setting]')) {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => onSettingChange(el));
  }
  for (const sw of $$('.swatch')) {
    sw.addEventListener('click', () => { state.settings.palette = sw.dataset.palette; saveSettings(); applySettings(); });
  }
  $('#btn-reminder-test').addEventListener('click', async () => {
    if (N.isNative) {
      const perm = await N.notificationPermission(true);
      if (perm !== 'granted') { toast('Notifications are not allowed for this app.'); renderReminderStatus(); return; }
      toast((await N.testNotification()) ? 'Test notification arrives in a moment' : 'Could not schedule a notification');
      renderReminderStatus();
      return;
    }
    const perm = await R.requestPermission();
    if (perm !== 'granted') { toast('Notifications are not allowed in this browser.'); renderReminderStatus(); return; }
    const ok = await R.showNotification('NBack reminder test', 'This is what your daily reminder looks like.');
    toast(ok ? 'Test notification sent' : 'Could not show a notification here');
    renderReminderStatus();
  });
  $('#btn-reminder-ics').addEventListener('click', () => {
    download('nback-daily-reminder.ics', R.buildIcs(state.settings.reminders.time), 'text/calendar');
    toast('Calendar event downloaded. Open it to add a daily alarm.');
  });

  $('#btn-export-json').addEventListener('click', () => {
    download(`nback-backup-${S.dayKey()}.json`, JSON.stringify(S.exportData(), null, 2));
    toast('Backup exported');
  });
  $('#btn-export-csv').addEventListener('click', () => {
    download(`nback-sessions-${S.dayKey()}.csv`, S.historyToCSV(state.history), 'text/csv');
    toast('CSV exported');
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = S.importData(data);
      state.history = S.loadHistory();
      state.settings = S.loadSettings();
      state.achievements = S.loadAchievements();
      applySettings();
      renderStats();
      toast(`Imported ${res.added} new session${res.added === 1 ? '' : 's'}`);
    } catch (e) {
      toast(`Import failed: ${e.message}`, 3500);
    }
  });
  $('#btn-clear').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete all data?', 'Sessions, achievements and records on this device will be erased. Export a backup first if you want to keep them.', 'Delete');
    if (!ok) return;
    S.clearHistory();
    S.saveAchievements({});
    state.history = [];
    state.achievements = {};
    renderStats();
    applySettings();
    toast('All data deleted');
  });
  $('#btn-history-more').addEventListener('click', () => { state.historyShown += 25; renderHistoryList(); });
  $('#dlg-howto').addEventListener('close', () => {
    const v = $('#dlg-howto').returnValue;
    if (v === 'tutorial') startTutorial();
    else if (v === 'video') openVideo();
    else S.setOnboarded();
  });
  $('#dlg-welcome').addEventListener('close', () => {
    const v = $('#dlg-welcome').returnValue;
    if (v === 'tutorial') startTutorial();
    else if (v === 'video') openVideo();
    else { S.setOnboarded(); toast('You can run the tutorial any time from Settings → Learn.', 3200); }
  });
  $('#dlg-video').addEventListener('close', () => {
    const vid = $('#video-2back');
    vid.pause();
    state.meta.watchedVideo = true;
    S.saveMeta(state.meta);
    S.setOnboarded();
    renderHome();
    if ($('#dlg-video').returnValue === 'tutorial') startTutorial();
  });
  $('#btn-video-settings').addEventListener('click', openVideo);
  $('#btn-video-home').addEventListener('click', openVideo);
  $('#btn-tutorial-settings').addEventListener('click', startTutorial);
  $('#btn-howto-settings').addEventListener('click', () => $('#dlg-howto').showModal());
  $('#coach-skip').addEventListener('click', () => { if (state.tutorial) state.tutorial.skip(); });
  $('#coach-voice').addEventListener('click', () => {
    state.settings.tutorialVoice = !state.settings.tutorialVoice;
    saveSettings();
    renderVoiceToggle();
    renderSettings();
    if (state.settings.tutorialVoice) narrate(narration.key); else stopNarration();
    toast(state.settings.tutorialVoice ? 'Voice-over on' : 'Voice-over off', 1200);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (state.tutorial) {
      const k = ev.key.toLowerCase();
      if (k === 'a' || ev.key === 'ArrowLeft') respond('position');
      else if (k === 'l' || ev.key === 'ArrowRight') respond('sound');
      else if (ev.key === 'Escape') state.tutorial.skip();
      else if (ev.key === 'Enter' && !$('#coach-next').hidden) $('#coach-next').click();
      return;
    }
    if (state.screen === 'play') {
      const k = ev.key.toLowerCase();
      if (k === 'a' || ev.key === 'ArrowLeft') { respond('position'); ev.preventDefault(); }
      else if (k === 'l' || ev.key === 'ArrowRight') { respond('sound'); ev.preventDefault(); }
      else if ((k === 'f' || ev.key === 'ArrowDown') && state.sequence.streams.includes('color')) { respond('color'); ev.preventDefault(); }
      else if (ev.key === ' ' || k === 'p') { ev.preventDefault(); if (state.runner && state.runner.paused) resumeSession(); else pauseSession(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); quitSession(); }
    } else if (ev.key === 'Enter' && state.screen === 'home' && tag !== 'button') {
      startSession();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'play' && !state.tutorial) pauseSession('The app went to the background.');
  });

  watchPosture((info, prev) => {
    state.posture = info;
    if (prev && state.screen === 'play' && !state.tutorial) pauseSession('The screen layout changed. Settle the phone, then resume.');
    if (state.screen === 'stats') renderStats();
    if (state.screen === 'settings') renderSettings();
  }, { enabled: () => state.settings.hingeAware });

  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  dark.addEventListener('change', () => { if (state.screen === 'stats') renderStats(); applySettings(); });
}

async function registerServiceWorker() {
  if (N.isNative || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready. Reopen the app to use it.', 3500);
      });
    });
  } catch { /* offline support is optional */ }
}

function initNative() {
  if (!N.isNative) return;
  root.dataset.native = 'android';
  N.watchFold(segments => setExternalSegments(segments));
  N.onBackButton(() => {
    const open = $$('dialog[open]');
    if (open.length) { open[open.length - 1].close(); return true; }
    if (state.tutorial) { state.tutorial.skip(); return true; }
    if (state.screen === 'play') { if (state.runner && !state.runner.paused) pauseSession(); else quitSession(); return true; }
    if (state.screen !== 'home') { show('home'); return true; }
    return false;
  });
}

function init() {
  bind();
  initNative();
  applySettings();
  show('home');
  registerServiceWorker();
  if (!S.isOnboarded()) setTimeout(() => $('#dlg-welcome').showModal(), 400);
  // warm the voice in the background (decoding needs a gesture on some browsers; failures are fine)
  document.addEventListener('pointerdown', () => { audio.unlock(); if (!audio.ready && !audio.failed) audio.preload(); if (!audio.sfxReady) audio.preloadSfx(); }, { once: true, passive: true });
}

init();
