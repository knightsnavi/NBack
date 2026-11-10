// Home: pick a mode and level, press Start. Everything else lives in Progress.
import { $, $$ } from '../dom.js';
import { state, saveSettings, currentLevel, assistActive } from '../state.js';
import { trialsForN } from '../game.js';
import * as S from '../storage.js';
import * as ST from '../stats.js';
import { ring } from '../charts.js';
import { setBadge } from '../board.js';
import { ASSIST_MAX_N } from '../strip.js';

function sessionMeta() {
  const s = state.settings;
  const n = currentLevel();
  const trials = trialsForN(n, s.length);
  const mins = Math.max(1, Math.round((trials * s.interval) / 60000));
  return `${ST.MODE_LABELS[s.mode]} · ${n}-back · ${trials} items · about ${mins} min${assistActive() ? ' · assisted' : ''}`;
}

function levelHint() {
  const s = state.settings;
  if (assistActive()) return 'Assisted practice. Your level does not change.';
  if (!s.adaptive) return 'Fixed level. Change it with − and +.';
  return s.progression === 'relaxed'
    ? 'Moves up when you reach 80% accuracy.'
    : 'Moves up when you make fewer than 3 mistakes on each button.';
}

export function renderHome() {
  const s = state.settings;
  const n = currentLevel();
  const sum = ST.summarize(state.history);

  $('#level-n').textContent = n;
  setBadge(n);
  $('#auto-level').checked = s.adaptive;
  $('#level-hint').textContent = levelHint();
  $('#n-minus').disabled = n <= S.MIN_N;
  $('#n-plus').disabled = n >= S.MAX_N;
  for (const chip of $$('#mode-chips .chip')) chip.setAttribute('aria-checked', String(chip.dataset.mode === s.mode));
  $('#start-meta').textContent = sessionMeta();
  $('#start-label').textContent = assistActive() ? 'Start practice' : 'Start session';
  $('#assist').checked = s.assist;
  $('#assist-sub').textContent = s.assist && n > ASSIST_MAX_N
    ? `Works up to ${ASSIST_MAX_N}-back, so it is off at this level`
    : 'Shows the recent turns and which one to compare';

  const goal = s.dailyGoal;
  $('#today-ring').innerHTML = ring({ value: sum.todayCount, max: Math.max(goal, 1), size: 44, stroke: 6 });
  $('#today-sub').textContent = goal > 0 ? `${sum.todayCount} of ${goal} today` : `${sum.todayCount} today`;
  $('#streak-text').textContent = sum.streak > 0 ? `🔥 ${sum.streak}-day streak` : 'No streak yet';

  const last = sum.last;
  const line = $('#last-line');
  if (last) {
    const delta = last.nextN - last.n;
    line.hidden = false;
    line.innerHTML = `Last: ${ST.MODE_LABELS[last.mode]} ${last.n}-back${last.assisted ? ' (assisted)' : ''} · ${Math.round(last.accuracy * 100)}% <b class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲ level up' : delta < 0 ? '▼ level down' : ''}</b>`;
  } else {
    line.hidden = true;
  }
  $('#btn-video-home').hidden = Boolean(state.meta.watchedVideo) || sum.sessions >= 8;
}

export function initHome({ start, openVideo }) {
  $('#btn-start').addEventListener('click', start);
  $('#btn-video-home').addEventListener('click', openVideo);
  for (const chip of $$('#mode-chips .chip')) {
    chip.addEventListener('click', () => {
      state.settings.mode = chip.dataset.mode;
      saveSettings();
      renderHome();
    });
  }
  const step = (by) => {
    S.setLevel(state.settings, currentLevel() + by);
    saveSettings();
    renderHome();
  };
  $('#n-minus').addEventListener('click', () => step(-1));
  $('#n-plus').addEventListener('click', () => step(1));
  $('#assist').addEventListener('change', (ev) => {
    state.settings.assist = ev.target.checked;
    saveSettings();
    renderHome();
  });
  $('#auto-level').addEventListener('change', (ev) => {
    state.settings.adaptive = ev.target.checked;
    saveSettings();
    renderHome();
  });
}
