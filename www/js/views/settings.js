// Settings. Each change is validated, saved, and applies only the effect it needs.
import { $, $$, toast } from '../dom.js';
import { state, saveSettings, currentLevel } from '../state.js';
import * as S from '../storage.js';
import * as ST from '../stats.js';
import * as R from '../reminders.js';
import * as N from '../native.js';
import { applyAppearance, applyAudio, armReminders } from '../effects.js';
import { setBadge } from '../board.js';

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function renderReminderStatus() {
  const s = state.settings;
  const el = $('#reminder-status');
  const when = ts => new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (!s.reminders.enabled) {
    el.textContent = 'Off. Turn it on and allow notifications when asked.';
  } else if (N.isNative) {
    const trainedToday = state.history.some(h => S.dayKey(h.ts) === S.dayKey());
    const next = N.reminderDates(s.reminders.time, trainedToday)[0];
    el.textContent = `Next reminder ${when(next)}, then every day. It skips days you have already trained. Reminders are set two weeks ahead and renew whenever you open the app.`;
  } else if (!R.support().notifications) {
    el.textContent = 'This browser cannot show notifications. Use "Add to calendar" for a reliable daily alarm.';
  } else if (R.permission() === 'denied') {
    el.textContent = 'Notifications are blocked for this site. Allow them in the browser settings, or use "Add to calendar".';
  } else if (R.permission() !== 'granted') {
    el.textContent = 'Waiting for notification permission.';
  } else {
    const bg = R.support().periodicSync ? 'Installed as an app, it can also remind you while closed.' : 'It fires while the app is open; add the calendar event too for a guaranteed alarm.';
    el.textContent = `Next reminder ${when(R.nextFireTime(s.reminders.time))}, skipped on days you already trained. ${bg}`;
  }
}

export function renderSettings() {
  const s = state.settings;
  for (const el of $$('[data-setting]')) {
    const key = el.dataset.setting;
    const v = key === 'level' ? currentLevel() : getPath(s, key);
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else if (String(el.value) !== String(v)) el.value = v;
  }
  $('#level-mode-name').textContent = `${ST.MODE_LABELS[s.mode]} mode. Each mode keeps its own level.`;
  $('#interval-val').textContent = `${(s.interval / 1000).toFixed(1)} s`;
  $('#stimulus-val').textContent = `${(s.stimulusMs / 1000).toFixed(2).replace(/0$/, '')} s`;
  for (const sw of $$('.swatch')) sw.setAttribute('aria-checked', String(sw.dataset.palette === s.palette));
  $('#btn-reminder-ics').hidden = N.isNative; // the app schedules real notifications instead
  renderReminderStatus();
  const p = state.posture;
  if (p) $('#posture-debug').textContent = `Layout: ${p.posture}, ${p.layout}, ${p.width} · ${window.innerWidth}×${window.innerHeight}`;
}

const APPEARANCE = new Set(['theme', 'palette', 'handed', 'hingeAware']);
const AUDIO = new Set(['sound', 'volume']);

async function onSettingChange(el) {
  const key = el.dataset.setting;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'range' || el.type === 'number') value = Number(el.value);
  else value = el.value;

  if (key === 'level') S.setLevel(state.settings, Number.isFinite(value) ? value : currentLevel());
  else setPath(state.settings, key, value);
  state.settings = S.sanitizeSettings(state.settings); // clamps ranges and keeps the stimulus shorter than the pace

  if (key === 'reminders.enabled' && state.settings.reminders.enabled) {
    const perm = N.isNative ? await N.notificationPermission(true) : await R.requestPermission();
    if (perm !== 'granted') {
      toast(N.isNative ? `Notifications are turned off for NBack. Allow them in ${N.settingsName} to get reminders.` : 'Notifications were not allowed. The calendar option still works.', 4000);
    }
  }
  saveSettings();

  if (APPEARANCE.has(key)) applyAppearance();
  if (key === 'hingeAware') window.dispatchEvent(new Event('resize')); // re-evaluate the fold layout
  if (AUDIO.has(key)) applyAudio();
  if (key.startsWith('reminders.')) armReminders();
  if (key === 'level' || key === 'mode') setBadge(currentLevel());
  renderSettings();
}

export function initSettings({ startTutorial, openVideo, showHowTo }) {
  for (const el of $$('[data-setting]')) {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => onSettingChange(el));
  }
  for (const sw of $$('.swatch')) {
    sw.addEventListener('click', () => {
      state.settings.palette = sw.dataset.palette;
      saveSettings();
      applyAppearance();
      renderSettings();
    });
  }
  $('#btn-reminder-test').addEventListener('click', async () => {
    if (N.isNative) {
      const perm = await N.notificationPermission(true);
      if (perm !== 'granted') toast(`Notifications are turned off for NBack in ${N.settingsName}.`, 3500);
      else toast((await N.testNotification()) ? 'Test notification arrives in a moment' : 'Could not schedule a notification');
    } else {
      const perm = await R.requestPermission();
      if (perm !== 'granted') toast('Notifications are not allowed in this browser.');
      else toast((await R.showNotification('NBack reminder test', 'This is what your daily reminder looks like.')) ? 'Test notification sent' : 'Could not show a notification here');
    }
    renderReminderStatus();
  });
  $('#btn-reminder-ics').addEventListener('click', async () => {
    const outcome = await N.saveFile('nback-daily-reminder.ics', R.buildIcs(state.settings.reminders.time), 'text/calendar');
    toast(outcome === 'failed' ? 'Could not create the calendar event' : 'Calendar event downloaded. Open it to add a daily alarm.', 3200);
  });
  $('#btn-tutorial-settings').addEventListener('click', startTutorial);
  $('#btn-video-settings').addEventListener('click', openVideo);
  $('#btn-howto-settings').addEventListener('click', showHowTo);
}
