// Composition root: builds the app from its modules and wires input to them.
import { $, $$, root, toast } from './dom.js';
import { state } from './state.js';
import { show, onShow, refresh } from './nav.js';
import * as S from './storage.js';
import * as N from './native.js';
import { watchPosture, setExternalSegments } from './posture.js';
import { applyAppearance, applyAudio, armReminders } from './effects.js';
import { startSession, respond, pauseSession, resumeSession, togglePause, quitSession, abortSession, sessionPhase, sessionActive, onSessionFinished } from './session.js';
import { startTutorial, skipTutorial, tutorialPress, tutorialAdvance, tutorialRunning, openVideo, initCoach } from './coach.js';
import { initHome, renderHome } from './views/home.js';
import { initResults, renderResults } from './views/results.js';
import { initProgress, renderProgress } from './views/progress.js';
import { initSettings, renderSettings } from './views/settings.js';
import { setBadge } from './board.js';
import { audio } from './state.js';

/* ---------- input: one place decides who receives a press ---------- */
function press(stream) {
  if (tutorialRunning()) tutorialPress(stream);
  else respond(stream);
}

function bindZones() {
  for (const btn of $$('.action')) {
    let lastPointer = -Infinity;
    // Respond on touch-down, not on release: reaction time matters here.
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      lastPointer = performance.now();
      press(btn.dataset.stream);
    });
    // Screen readers, switch access and keyboards activate with a click and no pointer event.
    btn.addEventListener('click', () => {
      if (performance.now() - lastPointer > 700) press(btn.dataset.stream);
    });
    btn.addEventListener('contextmenu', ev => ev.preventDefault());
  }
}

function bindKeyboard() {
  document.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ($$('dialog[open]').length) return;
    const k = ev.key.toLowerCase();
    if (tutorialRunning()) {
      if (k === 'a' || ev.key === 'ArrowLeft') press('position');
      else if (k === 'l' || ev.key === 'ArrowRight') press('sound');
      else if (ev.key === 'Escape') skipTutorial();
      else if (ev.key === 'Enter' && tag !== 'button') tutorialAdvance();
      return;
    }
    if (state.screen === 'play') {
      if (k === 'a' || ev.key === 'ArrowLeft') press('position');
      else if (k === 'l' || ev.key === 'ArrowRight') press('sound');
      else if (k === 'f' || ev.key === 'ArrowDown') press('color');
      else if (ev.key === ' ' || k === 'p') togglePause();
      else if (ev.key === 'Escape') quitSession();
      else return;
      ev.preventDefault();
    } else if (ev.key === 'Enter' && state.screen === 'home' && tag !== 'button') {
      startSession();
    }
  });
}

/* ---------- navigation chrome and dialogs ---------- */
function bindChrome() {
  $('#btn-back').addEventListener('click', () => show('home'));
  $('#nav-stats').addEventListener('click', () => show(state.screen === 'stats' ? 'home' : 'stats'));
  $('#nav-settings').addEventListener('click', () => show(state.screen === 'settings' ? 'home' : 'settings'));
  $('#nav-help').addEventListener('click', showHowTo);
  $('#btn-pause').addEventListener('click', () => pauseSession());
  $('#btn-resume').addEventListener('click', resumeSession);
  $('#btn-quit').addEventListener('click', quitSession);

  const afterIntro = (dlg, skippedMessage) => () => {
    const choice = dlg.returnValue;
    if (choice === 'tutorial') startTutorial();
    else if (choice === 'video') openVideo();
    else {
      S.setOnboarded();
      if (skippedMessage) toast(skippedMessage, 3200);
    }
  };
  const howto = $('#dlg-howto');
  howto.addEventListener('close', afterIntro(howto));
  const welcome = $('#dlg-welcome');
  welcome.addEventListener('close', afterIntro(welcome, 'You can run the tutorial any time from Settings → Learn.'));
}

function showHowTo() {
  const dlg = $('#dlg-howto');
  dlg.returnValue = '';
  dlg.showModal();
}

/* ---------- lifecycle ---------- */
function bindLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (sessionActive()) pauseSession('The app went to the background.');
    } else {
      armReminders(); // renew the two-week reminder window
    }
  });

  watchPosture((info, prev) => {
    state.posture = info;
    if (prev && sessionActive()) pauseSession('The screen layout changed. Settle the phone, then resume.');
    if (state.screen === 'stats' || state.screen === 'settings') refresh();
  }, { enabled: () => state.settings.hingeAware });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyAppearance();
    if (state.screen === 'stats') refresh();
  });

  // If anything throws mid-session, end it cleanly instead of leaving a frozen board.
  const onError = () => {
    if (!sessionActive() && !tutorialRunning()) return;
    try {
      if (tutorialRunning()) skipTutorial();
      abortSession();
      show('home');
      toast('Something went wrong and the session was stopped. Nothing was recorded.', 4000);
    } catch { /* nothing more we can do */ }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  S.onStorageError(() => toast('This device would not save your progress. Free up storage, then export a backup from Progress.', 6000));
}

function initNative() {
  if (!N.isNative) return;
  root.dataset.native = 'android';
  N.watchFold(segments => setExternalSegments(segments));
  N.onResume(() => armReminders());
  N.onBackButton(() => {
    const open = $$('dialog[open]');
    if (open.length) { open[open.length - 1].close(); return true; }
    if (tutorialRunning()) { skipTutorial(); return true; }
    if (sessionActive()) {
      // back pauses a running session; pressed again (or during the countdown) it leaves
      if (sessionPhase() === 'running') pauseSession(); else quitSession();
      return true;
    }
    if (state.screen !== 'home') { show('home'); return true; }
    return false;
  });
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

/** The layout relies on a few modern CSS features; an outdated system WebView would render it broken. */
function checkBrowserSupport() {
  const ok = window.CSS && CSS.supports
    && CSS.supports('width', '1cqw')
    && CSS.supports('height', '1dvh')
    && CSS.supports('color', 'color-mix(in oklab, red 50%, blue)');
  if (ok) return;
  const banner = $('#unsupported');
  banner.hidden = false;
  $('#unsupported-ok').addEventListener('click', () => { banner.hidden = true; });
}

function reloadState() {
  state.settings = S.loadSettings();
  state.history = S.loadHistory();
  state.achievements = S.loadAchievements();
  applyAppearance();
  applyAudio();
  armReminders();
  setBadge(S.levelFor(state.settings));
  refresh();
}

function init() {
  onShow('home', renderHome);
  onShow('stats', renderProgress);
  onShow('settings', renderSettings);

  initHome({ start: startSession, openVideo });
  initResults({ playAgain: startSession, goHome: () => show('home') });
  initProgress({ onDataChanged: reloadState });
  initSettings({ startTutorial, openVideo, showHowTo });
  initCoach();
  onSessionFinished((entry, score) => {
    renderResults(entry, score);
    show('results');
  });

  bindZones();
  bindKeyboard();
  bindChrome();
  bindLifecycle();
  initNative();

  applyAppearance();
  applyAudio();
  armReminders();
  show('home');
  checkBrowserSupport();
  registerServiceWorker();

  if (!S.isOnboarded()) {
    setTimeout(() => {
      if (state.screen !== 'home' || sessionActive() || tutorialRunning() || $$('dialog[open]').length) return;
      const dlg = $('#dlg-welcome');
      dlg.returnValue = '';
      dlg.showModal();
    }, 400);
  }
  // Warm up audio on the first touch (browsers require a gesture); failures are fine.
  document.addEventListener('pointerdown', () => {
    audio.unlock();
    if (!audio.ready && !audio.failed) audio.preload();
    if (!audio.sfxReady) audio.preloadSfx();
  }, { once: true, passive: true });
}

init();
