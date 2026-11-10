// Side effects of settings, split so that changing one setting only redoes
// the work that setting actually affects.
import { $, root, debounce } from './dom.js';
import { state, audio } from './state.js';
import * as S from './storage.js';
import * as R from './reminders.js';
import * as N from './native.js';

export function applyAppearance() {
  const s = state.settings;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = s.theme;
  root.dataset.palette = s.palette;
  root.dataset.handed = s.handed;
  root.dataset.hinge = s.hingeAware ? 'on' : 'off';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--accent').trim() || '#7c5cff');
  const dark = s.theme === 'dark' || (s.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  N.setStatusBar(dark);
}

export function applyAudio() {
  audio.setVolume(state.settings.volume);
  audio.setMuted(!state.settings.sound);
}

function trainedToday() {
  const today = S.dayKey();
  return state.history.some(h => S.dayKey(h.ts) === today);
}

function armRemindersNow() {
  const { enabled, time } = state.settings.reminders;
  if (N.isNative) {
    if (enabled) N.scheduleReminders(time, trainedToday());
    else N.cancelReminders();
    return;
  }
  R.schedule(state.settings, () => state.history, (day) => {
    state.meta.lastNotifiedDay = day;
    S.saveMeta(state.meta);
  });
  R.syncConfig({
    enabled,
    time,
    lastSessionDay: state.history.length ? S.dayKey(state.history[state.history.length - 1].ts) : null,
    lastNotifiedDay: state.meta.lastNotifiedDay || null,
  });
}

/** (Re)schedule the daily reminder. Debounced: safe to call on every keystroke. */
export const armReminders = debounce(armRemindersNow, 400);
