// Learning aids: the guided tutorial (coach card, narration, turn strip) and
// the explainer video.
import { $, $$, app, toast, sleep } from './dom.js';
import { state, audio, saveSettings, currentLevel } from './state.js';
import { show, refresh } from './nav.js';
import { createTutorial } from './tutorial.js';
import { renderStrip } from './strip.js';
import { abortSession, pauseSession, sessionActive } from './session.js';
import { clearCells, lightCell, speakLetter, setBadge, setZones, clearZoneFeedback, flash, pulsePress, hintZones, buzz, sfx } from './board.js';
import * as S from './storage.js';
import * as N from './native.js';

let tutorial = null;

/* ---------- narration ---------- */
// One clip at a time. `done` resolves when the clip ends, fails, or is stopped.
const narration = { el: null, timer: null, key: null, done: Promise.resolve(), settle: null };

function stopNarration() {
  clearTimeout(narration.timer);
  narration.timer = null;
  if (narration.el) {
    narration.el.onended = null;
    narration.el.onerror = null;
    narration.el.pause();
    narration.el = null;
  }
  if (narration.settle) { narration.settle(); narration.settle = null; }
  $('#coach-voice').classList.remove('speaking');
}

function narrate(key, delay = 0) {
  stopNarration();
  narration.key = key;
  if (!key || !state.settings.tutorialVoice) { narration.done = Promise.resolve(); return; }
  narration.done = new Promise((resolve) => { narration.settle = resolve; });
  const finish = () => {
    $('#coach-voice').classList.remove('speaking');
    narration.el = null;
    if (narration.settle) { narration.settle(); narration.settle = null; }
  };
  const play = () => {
    narration.timer = null;
    const el = new Audio(`audio/tutorial/${key}.mp3`);
    el.volume = Math.min(1, state.settings.volume);
    narration.el = el;
    el.onended = finish;
    el.onerror = finish;
    $('#coach-voice').classList.add('speaking');
    el.play().catch(finish);
  };
  if (delay > 0) narration.timer = setTimeout(play, delay);
  else play();
}

/** Run cb once the current narration has finished; with the voice off, after fallbackMs. */
function afterVoice(cb, fallbackMs = 1000) {
  if (!state.settings.tutorialVoice || !narration.key) { setTimeout(cb, fallbackMs); return; }
  const done = narration.done;
  Promise.race([done, sleep(25000)]).then(() => setTimeout(cb, 500));
}

function renderVoiceToggle() {
  const btn = $('#coach-voice');
  const on = state.settings.tutorialVoice;
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Voice-over on' : 'Voice-over off');
}

export function toggleTutorialVoice() {
  state.settings.tutorialVoice = !state.settings.tutorialVoice;
  saveSettings();
  renderVoiceToggle();
  if (state.settings.tutorialVoice) narrate(narration.key); else stopNarration();
  toast(state.settings.tutorialVoice ? 'Voice-over on' : 'Voice-over off', 1200);
  refresh();
}

/* ---------- tutorial ---------- */
export const tutorialRunning = () => Boolean(tutorial);

export async function startTutorial() {
  if (tutorial || state.tutorialActive) return;
  state.tutorialActive = true; // set before any await so a session cannot start underneath
  abortSession();
  N.keepAwake(true);
  await audio.unlock();
  if (!audio.sfxReady) audio.preloadSfx();
  if (!audio.ready && !audio.failed) await Promise.race([audio.preload(), sleep(2500)]);
  for (const dlg of $$('dialog[open]')) dlg.close();

  setZones(['position', 'sound']);
  $('#board-overlay').hidden = true;
  show('play');
  app.dataset.tutorial = 'on';
  $('#coach').hidden = false;
  $('#strip').hidden = false;
  renderStrip([], {});
  renderVoiceToggle();

  const ui = {
    light: (pos, letter) => { lightCell(pos); speakLetter(letter); },
    clear: () => clearCells(),
    hint: streams => hintZones(streams),
    strip: (turns, marks) => renderStrip(turns, marks),
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
    next: (label, onButton) => {
      const next = $('#coach-next');
      next.hidden = false;
      next.textContent = label;
      next.onclick = onButton;
    },
    feedback: (stream, kind) => {
      if (state.settings.feedback) flash(stream, kind, kind === 'missed' ? 600 : 380);
      buzz(kind === 'good' ? 'tap' : kind);
    },
    sfx: kind => sfx(kind),
    badge: n => setBadge(n),
    afterVoice,
    done: reason => endTutorial(reason),
  };
  tutorial = createTutorial(ui);
  tutorial.start();
}

function endTutorial(reason) {
  stopNarration();
  narration.key = null;
  tutorial = null;
  state.tutorialActive = false;
  app.dataset.tutorial = 'off';
  $('#coach').hidden = true;
  $('#strip').hidden = true;
  clearZoneFeedback();
  clearCells();
  S.setOnboarded();
  setBadge(currentLevel());
  N.keepAwake(false);
  show('home');
  toast(reason === 'completed' ? 'Tutorial complete. Want the strip of recent turns in real games? Turn on Assist on the home screen.' : 'Tutorial skipped. Find it again under Settings → Learn.', reason === 'completed' ? 5200 : 3200);
}

export function tutorialPress(stream) {
  if (!tutorial) return;
  pulsePress(stream);
  tutorial.press(stream);
}

export function skipTutorial() {
  if (tutorial) tutorial.skip();
}

/** Enter on a keyboard presses the coach's button when it is showing. */
export function tutorialAdvance() {
  const next = $('#coach-next');
  if (tutorial && !next.hidden) next.click();
}

/* ---------- explainer video ---------- */
export function openVideo() {
  if (tutorial) return;
  for (const dlg of $$('dialog[open]')) if (dlg.id !== 'dlg-video') dlg.close();
  if (sessionActive()) pauseSession('Paused for the video.');
  const dlg = $('#dlg-video');
  dlg.returnValue = '';
  dlg.showModal();
  N.keepAwake(true);
  const vid = $('#video-2back');
  vid.currentTime = 0;
  vid.play().catch(() => {});
}

export function initCoach() {
  $('#coach-skip').addEventListener('click', skipTutorial);
  $('#coach-voice').addEventListener('click', toggleTutorialVoice);
  $('#dlg-video').addEventListener('close', () => {
    $('#video-2back').pause();
    if (!sessionActive()) N.keepAwake(false);
    state.meta.watchedVideo = true;
    S.saveMeta(state.meta);
    S.setOnboarded();
    refresh();
    if ($('#dlg-video').returnValue === 'tutorial') startTutorial();
  });
}
